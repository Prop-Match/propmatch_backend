import { PropertyType } from '@generated/prisma/enums';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Hybrid search query (PRO-11). Matches the frontend `PropertySearchQuery`
 * (src/lib/api/contracts/property.ts).
 *
 * All fields optional. The `@Type` transforms exist because query-string
 * values arrive as strings; the global ValidationPipe has `transform: true`,
 * so these become real numbers/booleans before the service sees them.
 *
 * `q` is the SEMANTIC half of the hybrid search — today a naive text match,
 * later fed to Samer's ChromaDB embeddings. The hard filters below are the
 * SQL half.
 */
export class SearchPropertiesDto {
  /** Free-text query — the semantic half (ChromaDB seam). */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  propertyType?: PropertyType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxRent?: number;

  /** Minimum bedrooms (the frontend sends "N+"). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  // `@Type(() => Boolean)` would turn the string "false" into true (Boolean of
  // any non-empty string), so parse it explicitly.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isFurnished?: boolean;
}
