import { IsDefined, IsString, Matches } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SubmitVerificationDto {
  @IsDefined({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @Matches(/^\d{14}$/, {
    message: 'الرقم القومي يجب أن يتكون من 14 رقمًا.',
  })
  nationalId!: string;
}
