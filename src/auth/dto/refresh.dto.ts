import { IsNotEmpty, IsString } from 'class-validator';

import { i18nValidationMessage } from 'nestjs-i18n';

export class RefreshDto {
  @IsString({ message: i18nValidationMessage('validation.INVALID_STRING') })
  @IsNotEmpty({ message: i18nValidationMessage('validation.REQUIRED') })
  refreshToken!: string;
}
