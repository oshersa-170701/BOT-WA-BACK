import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  app.enableCors({ origin: true });
  app.useStaticAssets(join(__dirname, '..', 'www'));

  app.use((req, res, next) => {
    if (req.path.startsWith('/users') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();