import { IsIn, IsOptional } from 'class-validator';

export class PropertyAnalyticsQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', 'current', 'lifetime'])
  period: '7d' | '30d' | 'current' | 'lifetime' = '30d';
}
