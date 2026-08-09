import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { MAX_EMAIL_LENGTH, normalizeEmailTransform } from '../email';

export class ForgetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(MAX_EMAIL_LENGTH)
  @Transform(normalizeEmailTransform)
  email!: string;
}
