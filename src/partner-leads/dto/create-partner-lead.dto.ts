import { Equals, IsBoolean, IsIn } from 'class-validator';

export type PartnerServiceType = 'MOVING' | 'INSURANCE';

export class CreatePartnerLeadDto {
  @IsIn(['MOVING', 'INSURANCE'])
  serviceType!: PartnerServiceType;

  @IsBoolean({ message: 'PARTNER_LEAD_CONSENT_REQUIRED' })
  @Equals(true, { message: 'PARTNER_LEAD_CONSENT_REQUIRED' })
  consent!: boolean;
}
