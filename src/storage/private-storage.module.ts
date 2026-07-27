import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalPrivateObjectStorageService } from './local-private-object-storage.service';
import { PRIVATE_OBJECT_STORAGE } from './private-object-storage.token';
import { PrivateStorageController } from './private-storage.controller';

@Module({
  imports: [ConfigModule],
  providers: [
    LocalPrivateObjectStorageService,
    {
      provide: PRIVATE_OBJECT_STORAGE,
      useExisting: LocalPrivateObjectStorageService,
    },
  ],
  controllers: [PrivateStorageController],
  exports: [PRIVATE_OBJECT_STORAGE],
})
export class PrivateStorageModule {}
