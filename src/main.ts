import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  app.enableCors({ origin: true });

  // Sirve los archivos estáticos de Ionic directamente
  app.useStaticAssets(join(__dirname, '..', 'www'));

  // Redirige cualquier ruta que no sea de la API hacia el index.html de Ionic (para el SPA router)
  app.use((req, res, next) => {
    if (req.path.startsWith('/users') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();