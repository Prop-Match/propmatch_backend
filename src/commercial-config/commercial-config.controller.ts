import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireCapability } from '../admin/decorators/require-capability.decorator';
import { CapabilitiesGuard } from '../admin/guards/capabilities.guard';
import { CommercialConfigService } from './commercial-config.service';
import { UpdatePlanConfigurationDto } from './dto/update-plan-configuration.dto';
import { UpdateProductConfigurationDto } from './dto/update-product-configuration.dto';

@Controller('commercial-config')
export class CommercialCatalogController {
  constructor(private readonly commercialConfig: CommercialConfigService) {}

  @Get('catalog')
  getCatalog() {
    return this.commercialConfig.getCatalog();
  }
}

@Controller('admin/commercial-config')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilitiesGuard)
@Roles('ADMIN')
@RequireCapability('commercial:manage')
export class AdminCommercialConfigController {
  constructor(private readonly commercialConfig: CommercialConfigService) {}

  @Get()
  getCatalog() {
    return this.commercialConfig.getCatalog();
  }

  @Patch('plans/:planType')
  updatePlan(
    @Req() req: { user: { userId: string } },
    @Param('planType') planType: string,
    @Body() dto: UpdatePlanConfigurationDto,
  ) {
    return this.commercialConfig.updatePlan(req.user.userId, planType, dto);
  }

  @Patch('products/:paymentType')
  updateProduct(
    @Req() req: { user: { userId: string } },
    @Param('paymentType') paymentType: string,
    @Body() dto: UpdateProductConfigurationDto,
  ) {
    return this.commercialConfig.updateProduct(
      req.user.userId,
      paymentType,
      dto,
    );
  }
}
