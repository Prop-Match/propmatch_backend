import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name);
  private firebaseApp: App | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const serviceAccountJson = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT');
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID') || 'propmatch-ai';

    try {
      if (serviceAccountJson) {
        const credentials = JSON.parse(serviceAccountJson);
        this.firebaseApp = initializeApp({
          credential: cert(credentials),
          projectId: credentials.project_id || projectId,
        });
        this.logger.log('Firebase Admin initialized with service account.');
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.firebaseApp = initializeApp({
          credential: applicationDefault(),
          projectId,
        });
        this.logger.log('Firebase Admin initialized with default credentials.');
      } else {
        this.logger.warn(
          'No FIREBASE_SERVICE_ACCOUNT configured. Push notifications will log in dry-run mode.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK:', error);
    }
  }

  async saveDeviceToken(userId: string, token: string, platform?: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform, updatedAt: new Date() },
      create: { userId, token, platform },
    });
    this.logger.log(`Device token registered for user: ${userId}`);
  }

  async removeDeviceToken(token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({
      where: { token },
    });
  }

  async sendToUser(
    userId: string,
    notification: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return;
    }

    const tokenList = tokens.map((t) => t.token);
    await this.sendMulticast(tokenList, notification);
  }

  async sendToUsers(
    userIds: string[],
    notification: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    if (userIds.length === 0) return;

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });

    if (tokens.length === 0) return;

    const tokenList = tokens.map((t) => t.token);
    await this.sendMulticast(tokenList, notification);
  }

  private async sendMulticast(
    tokens: string[],
    notification: { title: string; body: string; data?: Record<string, string> },
  ): Promise<void> {
    if (!this.firebaseApp) {
      this.logger.log(
        `[DRY-RUN FCM] Sending notification to ${tokens.length} devices: "${notification.title}" - "${notification.body}"`,
      );
      return;
    }

    try {
      const messaging = getMessaging(this.firebaseApp);
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data,
      });

      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              failedTokens.push(tokens[idx]);
            }
          }
        });

        if (failedTokens.length > 0) {
          await this.prisma.deviceToken.deleteMany({
            where: { token: { in: failedTokens } },
          });
          this.logger.log(`Cleaned up ${failedTokens.length} stale FCM device tokens`);
        }
      }
    } catch (error) {
      this.logger.error('Error sending multicast FCM notification:', error);
    }
  }
}
