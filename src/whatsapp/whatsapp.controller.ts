import { Controller, Get, Param, Post } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) { }

  @Get('qr/:whatsappPhone')
  async getQrCode(@Param('whatsappPhone') whatsappPhone: string) {
    return await this.whatsappService.getQrCode(whatsappPhone);
  }

  @Post('disconnect/:whatsappPhone')
  async disconnectWhatsApp(@Param('whatsappPhone') whatsappPhone: string) {
    return await this.whatsappService.disconnectWhatsApp(whatsappPhone);
  }
  @Get('status/:phone')
  async getStatus(@Param('phone') phone: string) {
    return await this.whatsappService.checkConnectionStatus(phone);
  }
}