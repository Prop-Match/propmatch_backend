/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
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
}
