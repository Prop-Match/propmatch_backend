import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { SupportPriority } from '@generated/prisma/enums';
import { CustomerSupportService } from './customer-support.service';
import { CreateAgentEscalationDto } from './dto/create-agent-escalation.dto';
import { SupportAgentInternalGuard } from './support-agent-internal.guard';

@Controller('internal/support-agent')
@UseGuards(SupportAgentInternalGuard)
export class SupportAgentInternalController {
  constructor(private readonly customerSupport: CustomerSupportService) {}

  @Post('escalations')
  async createEscalation(
    @Headers('x-propmatch-user-id') userId: string,
    @Body() dto: CreateAgentEscalationDto,
  ) {
    return this.customerSupport.createAgentEscalation(userId, {
      agentRunId: dto.agentRunId,
      message: dto.message,
      reason: dto.reason,
      priority: dto.priority as SupportPriority,
    });
  }
}
