import { ArrayMinSize, IsArray, IsIn } from 'class-validator';

export type PartnerServiceType = 'MOVING' | 'INSURANCE';

export class CreatePartnerLeadDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر خدمة واحدة على الأقل' })
  @IsIn(['MOVING', 'INSURANCE'], { each: true })
  serviceTypes!: PartnerServiceType[];
}
