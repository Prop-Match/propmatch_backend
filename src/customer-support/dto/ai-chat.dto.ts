import { IsArray, IsNotEmpty } from 'class-validator';

export class AiChatDto {
  @IsNotEmpty()
  message: string;
  @IsArray()
  history: any[];
}
