import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ESTO ES LO QUE PERMITE QUE NETIFY / RAILWAY FRONT HABLE CON EL BACKEND
  app.enableCors({
    origin: '*', // O puedes poner la URL específica de tu frontend en Railway/Netlify
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();