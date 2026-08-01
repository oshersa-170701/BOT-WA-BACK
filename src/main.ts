import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Activar Helmet de manera segura (puedes ajustarlo si bloquea scripts)
  app.use(helmet({ contentSecurityPolicy: false }));

  // 1. Habilitar CORS
  app.enableCors({ origin: true });

  // 2. Servir la carpeta 'www' del frontend de manera estática
  app.useStaticAssets(join(__dirname, '..', 'www'));

  // 3. MIDDLEWARE LIMPIO PARA LA SPA DE IONIC
  app.use((req, res, next) => {
    // Si la ruta pertenece a los endpoints de la API o es un archivo físico con extensión (js, css, png...), déjalo pasar
    if (
      req.path.startsWith('/users') || 
      req.path.startsWith('/products') || 
      req.path.startsWith('/bot_keywords') || 
      req.path.startsWith('/bot_settings') || 
      req.path.startsWith('/chat_logs') || 
      req.path.startsWith('/quotes') || 
      req.path.startsWith('/leads') || 
      req.path.startsWith('/whatsapp') || 
      req.path.includes('.')
    ) {
      return next();
    }
    // De lo contrario, entrega el index.html para que el enrutador de Angular maneje las vistas
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Servidor corriendo en puerto ${port}`);
}
bootstrap();