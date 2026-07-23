import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { existsSync } from 'fs';
import { AcceptLanguageResolver, I18nModule } from 'nestjs-i18n';
import * as path from 'path';
import { PrismaModule } from 'prisma/prisma.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { LegalSupportModule } from './legal-support/legal-support.module';
import { MessagesModule } from './messages/messages.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { PropertiesModule } from './properties/properties.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RegionsModule } from './regions/regions.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SupportModule } from './support/support.module';
import { TenantRequestsModule } from './tenant-requests/tenant-requests.module';
import { UsersModule } from './users/users.module';
import { VerificationModule } from './verification/verification.module';

/**
 * `nest build` nests compiled output under dist/src, so `../i18n/` resolves
 * correctly there. Running straight from src (ts-jest, ts-node dev) has no
 * such nesting, so the same relative path misses — fall back to the sibling
 * `i18n/` directory in that case.
 */
const i18nPath = existsSync(path.join(__dirname, '../i18n/'))
  ? path.join(__dirname, '../i18n/')
  : path.join(__dirname, 'i18n/');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.development', '.env.production'],
    }),
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    AdminModule,
    PrismaModule,
    RealtimeModule,
    I18nModule.forRoot({
      fallbackLanguage: 'ar',
      loaderOptions: {
        path: i18nPath,
        watch: true,
      },
      resolvers: [new AcceptLanguageResolver()],
    }),
    PropertiesModule,
    VerificationModule,
    TenantRequestsModule,
    OffersModule,
    MessagesModule,
    PaymentsModule,
    ReviewsModule,
    LegalSupportModule,
    RegionsModule,
    SupportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
