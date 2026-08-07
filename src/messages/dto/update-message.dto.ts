import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body of a match-message edit. Non-empty, same 1000-char cap as `send`. */
export class UpdateMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;
}
