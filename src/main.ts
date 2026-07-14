import { NestFactory } from '@nestjs/core';
import 'dotenv/config';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { CustomI18nValidationExceptionFilter } from './auth/filters/i18n-validation.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
bootstrap();
