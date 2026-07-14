import { Module } from '@nestjs/common';
import { transformUserToFrontend } from './mappers/user.mapper';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService, transformUserToFrontend],
})
export class UsersModule {}
