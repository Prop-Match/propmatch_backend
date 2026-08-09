import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MAX_EMAIL_LENGTH, normalizeEmailTransform } from '../email';

export class VerifyEmailOtpDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  @MaxLength(MAX_EMAIL_LENGTH)
  @Transform(normalizeEmailTransform)
  email!: string;

  @Matches(/^\d{6}$/, {
    message: 'Verification code must contain exactly six digits.',
  })
  code!: string;
}
