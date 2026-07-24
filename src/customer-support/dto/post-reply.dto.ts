import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class PostReplyDto {
  @IsString()
  @IsNotEmpty()
  content!: string;
  @IsBoolean()
  internal?: boolean;
}
