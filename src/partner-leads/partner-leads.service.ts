import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PartnerServiceType } from './dto/create-partner-lead.dto';

/** Strategic partner routed per service type (mirrors the frontend mock). */
const PARTNER_NAME: Record<PartnerServiceType, string> = {
  MOVING: 'نقل المنصورة',
  INSURANCE: 'تأمين دلتا',
};

/**
 * PRO — partner strategic lead routing. POST /partner-leads creates one PENDING
 * lead per requested service type. Matches the frontend contract
 * (`src/mocks/router.ts` /partner-leads → { items }).
 */
@Injectable()
export class PartnerLeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, serviceTypes: PartnerServiceType[]) {
    const items = await Promise.all(
      serviceTypes.map((serviceType) =>
        this.prisma.partnerLead.create({
          data: {
            tenantId,
            serviceType,
            partnerName: PARTNER_NAME[serviceType],
            status: 'PENDING',
          },
        }),
      ),
    );
    return { items };
  }
}
