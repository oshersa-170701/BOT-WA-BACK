import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotSetting } from './entities/bot_setting.entity';
import { CreateBotSettingDto } from './dto/create-bot_setting.dto';
import { UpdateBotSettingDto } from './dto/update-bot_setting.dto';

@Injectable()
export class BotSettingsService {
  constructor(
    @InjectRepository(BotSetting)
    private readonly botSettingRepository: Repository<BotSetting>,
  ) {}

  async create(whatsappPhone: string, createBotSettingDto: CreateBotSettingDto) {
    const setting = this.botSettingRepository.create({
      ...createBotSettingDto,
      whatsapp_phone: whatsappPhone, // <-- Asociamos los ajustes al número de WhatsApp del usuario
    });
    return await this.botSettingRepository.save(setting);
  }

  async findByPhone(whatsappPhone: string) {
    let setting = await this.botSettingRepository.findOneBy({ whatsapp_phone: whatsappPhone });
    
    // Si el usuario aún no tiene configuración guardada, le devolvemos una por defecto automáticamente
    if (!setting) {
      setting = this.botSettingRepository.create({
        whatsapp_phone: whatsappPhone,
        bot_name: 'Asistente Virtual',
        welcome_message: '¡Hola! Bienvenido a nuestro servicio.',
        fallback_message: 'Lo siento, no entendí tu mensaje.',
      });
      await this.botSettingRepository.save(setting);
    }
    
    return setting;
  }

  async updateByPhone(whatsappPhone: string, updateBotSettingDto: UpdateBotSettingDto) {
    // Aseguramos que exista registro para este teléfono antes de actualizar
    let setting = await this.findByPhone(whatsappPhone);
    
    await this.botSettingRepository.update(setting.id, updateBotSettingDto);
    return await this.findByPhone(whatsappPhone);
  }
}