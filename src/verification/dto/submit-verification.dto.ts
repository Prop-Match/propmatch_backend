import { IsString, Matches, ValidateIf } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SubmitVerificationDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @Matches(/\S/, { message: i18nValidationMessage('validation.REQUIRED') })
  nationalId?: string;
}
