import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsStrongPassword,
  Matches,
  MinLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class CreateAdminDto {
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  email!: string;
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsStrongPassword(
    {},
    { message: i18nValidationMessage('validation.STRONG_PASSWORD') },
  )
  password!: string;

  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @MinLength(10, {
    message: i18nValidationMessage('validation.MIN_LENGTH', { value: 10 }),
  })
  @Matches(/^0(10|11|12|15)\d{8}$/, {
    message: i18nValidationMessage('validation.INVALID_PHONE_NUMBER'),
  })
  phoneNumber!: string;
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @MinLength(2, {
    message: i18nValidationMessage('validation.MIN_LENGTH', { value: 2 }),
  })
  fullName!: string;
}
