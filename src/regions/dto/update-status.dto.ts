import { IsBoolean } from 'class-validator';

export class UpdateStatusDto {
  @IsBoolean()
  status!: boolean;
}
