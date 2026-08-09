import { Controller, Post, Body } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) { }

  @Post('qr')
  async getQrCode(@Body() body: { whatsappPhone: string }) {
    return await this.whatsappService.getQrCode(body.whatsappPhone);
  }

  @Post('disconnect')
  async disconnectWhatsApp(@Body() body: { whatsappPhone: string }) {
    return await this.whatsappService.disconnectWhatsApp(body.whatsappPhone);
  }

  @Post('status')
  async getStatus(@Body() body: { whatsappPhone: string }) {
    return await this.whatsappService.checkConnectionStatus(body.whatsappPhone);
  }
}