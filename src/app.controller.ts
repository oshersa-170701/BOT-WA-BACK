import { Controller, Get, Res } from '@nestjs/common';
import { AppService } from './app.service';
import express from 'express';
import { join } from 'path';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Comodín para SPA: Redirige cualquier ruta que no sea API hacia el index.html de Ionic
  @Get('*')
  serveSpa(@Res() res: express.Response) {
    res.sendFile(join(__dirname, '..', 'www', 'index.html'));
  }
}