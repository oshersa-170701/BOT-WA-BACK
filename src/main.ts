async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  app.enableCors({ origin: true });
  app.setGlobalPrefix('api'); // <--- ESTO EVITA QUE EXPRESS SE PELEE CON LAS RUTAS DE ANGULAR

  app.useStaticAssets(join(__dirname, '..', 'www'));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();