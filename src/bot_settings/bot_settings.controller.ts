import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { BotSettingsService } from './bot_settings.service';
import { CreateBotSettingDto } from './dto/create-bot_setting.dto';
import { UpdateBotSettingDto } from './dto/update-bot_setting.dto';

@Controller('bot-settings')
export class BotSettingsController {
  constructor(private readonly botSettingsService: BotSettingsService) { }

  // 1. Ruta fija PRIMERO para evitar conflictos con parámetros
  @Post('load')
  async getSettingsByPhone(@Body() body: { whatsappPhone: string }) {
    return await this.botSettingsService.findOneByPhone(body.whatsappPhone);
  }

  // Crear configuración inicial vinculada al teléfono
  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createBotSettingDto: CreateBotSettingDto,
  ) {
    return this.botSettingsService.create(whatsappPhone, createBotSettingDto);
  }

  // Obtener la configuración específica de este número de WhatsApp
  @Get(':whatsappPhone')
  findByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.botSettingsService.findByPhone(whatsappPhone);
  }

  // Actualizar la configuración usando el teléfono como llave
  @Patch(':whatsappPhone')
  update(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() updateBotSettingDto: UpdateBotSettingDto,
  ) {
    return this.botSettingsService.updateByPhone(whatsappPhone, updateBotSettingDto);
  }
}