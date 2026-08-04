import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  // 1. Cambiar a NestExpressApplication para usar métodos de Express
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 2. Indicar la carpeta donde está compilado tu front (www)
  app.useStaticAssets(join(__dirname, '..', 'www'));

  // 3. Ruta comodín para que Angular/Ionic maneje las rutas del cliente sin error 404
  app.use((req, res, next) => {
    if (req.path.startsWith('/users') || req.path.startsWith('/products') || req.path.startsWith('/bot_keywords') || req.path.startsWith('/bot_settings') || req.path.startsWith('/chat_logs') || req.path.startsWith('/whatsapp') || req.path.startsWith('/quotes') || req.path.startsWith('/leads')) {
      return next();
    }
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();