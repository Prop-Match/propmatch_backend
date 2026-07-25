import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import 'dotenv/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { CustomI18nValidationExceptionFilter } from './auth/filters/i18n-validation.filter';
import * as path from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api');
  app.useStaticAssets(path.join(process.cwd(), 'public'), {
    prefix: '/public/',
  });

  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new CustomI18nValidationExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
