import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateFavoriteDto {
  @IsNotEmpty({ message: 'propertyId is required' })
  @IsUUID('4', { message: 'propertyId must be a valid UUID' })
  propertyId: string;
}
