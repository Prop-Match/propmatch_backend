import { IsIn, IsOptional, IsUUID } from 'class-validator';
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
}
