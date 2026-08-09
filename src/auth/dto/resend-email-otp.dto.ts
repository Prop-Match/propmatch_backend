import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { MAX_EMAIL_LENGTH, normalizeEmailTransform } from '../email';

export class ResendEmailOtpDto {
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  @MaxLength(MAX_EMAIL_LENGTH)
  @Transform(normalizeEmailTransform)
  email!: string;
}
