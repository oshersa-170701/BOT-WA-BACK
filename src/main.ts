import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({ origin: true });

  // Sirve los archivos estáticos de Ionic directamente
  app.useStaticAssets(join(__dirname, '..', 'www'));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
