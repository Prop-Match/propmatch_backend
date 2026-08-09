import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';

export class RequestReactivationDto {
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  @IsEmail({}, { message: i18nValidationMessage('validation.INVALID_EMAIL') })
  email!: string;

  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  password!: string;

  /** Optional for deleted-account restoration; used as the appeal message
   * when the verified account is suspended. */
  @IsOptional()
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @MinLength(10)
  @MaxLength(1000)
  message?: string;
}
