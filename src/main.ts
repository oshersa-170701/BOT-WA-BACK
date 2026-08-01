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
  app.enableCors();

  // 2. Servir la carpeta 'www' del frontend de manera estática
  app.useStaticAssets(join(__dirname, '..', 'www'));

  // 3. EL TRUCO PARA LA SPA: Redirigir cualquier ruta que no sea API al index.html de Ionic
  app.use((req, res, next) => {
    // Si la petición es para la API (ej. /users, /auth, etc.), déjala pasar al backend
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }
    // De lo contrario, entrega el index.html para que Angular controle las rutas
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Servidor corriendo en puerto ${port}`);
}
bootstrap();