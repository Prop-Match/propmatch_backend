import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class SignupDto {
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  email!: string;

  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  //   @MinLength(8, {
  //     message: i18nValidationMessage('validation.MIN_LENGTH', { min: 8 }),
  //   })
  //   @Matches(
  //     /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  //     {
  //       message: i18nValidationMessage('validation.PASSWORD_REQUIREMENTS'),
  //     },
  //   )
  password!: string;

  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @MinLength(2, {
    message: i18nValidationMessage('validation.MIN_LENGTH', { value: 2 }),
  })
  fullName!: string;

  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @MinLength(10, {
    message: i18nValidationMessage('validation.MIN_LENGTH', { value: 10 }),
  })
  // regex for egyptian phone numbers starting with (010, 011 ,012, 015) with 8 numbers after it
  @Matches(/^0(10|11|12|15)\d{8}$/, {
    message: i18nValidationMessage('validation.INVALID_PHONE_NUMBER'),
  })
  phoneNumber!: string;
}
