import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreatePartnerLeadDto } from './dto/create-partner-lead.dto';

/** Internal, consent-based requests. They are never routed to a partner. */
@Injectable()
export class PartnerLeadsService {
  private readonly logger = new Logger(PartnerLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(userId: string, dto: CreatePartnerLeadDto) {
    if (dto.consent !== true) {
      throw new BadRequestException({
        code: 'PARTNER_LEAD_CONSENT_REQUIRED',
        message:
          'Explicit consent is required before creating the service request.',
      });
    }

    const existing = await this.prisma.partnerLead.findFirst({
      where: { userId, serviceType: dto.serviceType, status: 'PENDING' },
    });

    if (existing) {
      throw new ConflictException({
        code: 'PARTNER_LEAD_ALREADY_PENDING',
        message: 'An equivalent partner lead is already pending review.',
      });
    }

    const lead = await this.prisma.partnerLead.create({
      data: {
        userId,
        serviceType: dto.serviceType,
        consentedAt: new Date(),
        status: 'PENDING',
      },
    });

    // Existing admin queue announcements are best-effort. The database row
    // remains the source of truth if a socket delivery is temporarily down.
    try {
      this.realtime.partnerLeadCreated({
        leadId: lead.id,
        userId,
        serviceType: lead.serviceType,
        status: 'PENDING',
        createdAt: lead.createdAt,
      });
    } catch (error) {
      this.logger.warn(
        `Partner lead ${lead.id} was stored but its realtime admin notification failed: ${String(error)}`,
      );
    }

    return {
      id: lead.id,
      serviceType: lead.serviceType,
      status: lead.status,
      consentedAt: lead.consentedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
    };
  }
}
