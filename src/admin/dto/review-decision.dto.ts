import { IsIn, IsOptional, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class ReviewDecisionDto {
  @IsIn(['approve', 'reject'], {
    message: i18nValidationMessage('validation.INVALID_STRING'),
  })
  decision!: 'approve' | 'reject';

  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  reason?: string;
}
