import { OmitType } from '@nestjs/mapped-types';
import { CreatePropertyDto } from './create-property.dto';

/** Text fields received alongside ordered image parts in multipart submissions. */
export class CreatePropertyMultipartDto extends OmitType(CreatePropertyDto, [
  'images',
] as const) {}
