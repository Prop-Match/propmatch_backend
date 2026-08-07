import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  BILLABLE_PAYMENT_TYPES,
  type BillablePaymentType,
} from '../pricing.catalog';

export class CreateCheckoutDto {
  @IsIn(BILLABLE_PAYMENT_TYPES)
  paymentType: BillablePaymentType;

  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @IsOptional()
  @IsIn(['CARD', 'WALLET'])
  method?: 'CARD' | 'WALLET';

  @ValidateIf((dto: CreateCheckoutDto) => dto.method === 'WALLET')
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s-]/g, '') : undefined,
  )
  @Matches(/^(?:\+20|0020|0)1[0125]\d{8}$/, {
    message: 'walletPhone must be a valid Egyptian mobile number',
  })
  walletPhone?: string;
}
