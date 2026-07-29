import { Transform, TransformFnParams } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { PropertyFieldsDto } from './property-fields.dto';

function jsonStringArray({ value }: TransformFnParams): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Full replacement of landlord-authored property fields.
 * Existing images are retained by id; newly uploaded image parts follow them.
 */
export class UpdatePropertyMultipartDto extends PropertyFieldsDto {
  @Transform(jsonStringArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  existingImageIds: string[];
}
