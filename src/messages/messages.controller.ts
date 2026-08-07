import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessagesService } from './messages.service';

@Controller('matches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT', 'LANDLORD')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get() list(@Request() r: { user: { userId: string } }) {
    return this.messages.list(r.user.userId);
  }
  @Get(':id/messages') get(
    @Request() r: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.messages.messages(r.user.userId, id);
  }
  @Post(':id/messages') send(
    @Request() r: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(r.user.userId, id, dto);
  }

  @Patch('messages/:messageId') update(
    @Request() r: { user: { userId: string } },
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messages.updateMessage(r.user.userId, messageId, dto.body);
  }

  @Delete('messages/:messageId') delete(
    @Request() r: { user: { userId: string } },
    @Param('messageId') messageId: string,
  ) {
    return this.messages.deleteMessage(r.user.userId, messageId);
  }
}
