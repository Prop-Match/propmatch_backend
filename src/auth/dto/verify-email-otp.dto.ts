import { IsEmail, Matches } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class VerifyEmailOtpDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  email!: string;

  @Matches(/^\d{6}$/, {
    message: 'Verification code must contain exactly six digits.',
  })
  code!: string;
}
