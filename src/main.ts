import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
async function bootstrap() {
  // Cambiamos a NestExpressApplication para poder usar métodos de Express
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Activar Helmet de inmediato
  app.use(helmet());
  // 1. Habilitar CORS
  app.enableCors();

  // 2. Servir la carpeta 'www' del frontend de manera estática
  app.useStaticAssets(join(__dirname, '..', 'www'));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(` Servidor corriendo en puerto ${port}`);
}
bootstrap();
