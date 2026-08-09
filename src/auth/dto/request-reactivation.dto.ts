import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class RequestReactivationDto {
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  email!: string;

  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  password!: string;
}
