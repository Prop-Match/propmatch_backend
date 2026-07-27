import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PostReplyDto {
  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
