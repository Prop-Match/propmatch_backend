import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { PropertyFieldsDto } from './property-fields.dto';

export class CreatePropertyDto extends PropertyFieldsDto {
  /** Array of image URLs — at least 1 required */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  images: string[];
}
