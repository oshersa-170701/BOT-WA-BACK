import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotKeyword } from './entities/bot_keyword.entity';
import { CreateBotKeywordDto } from './dto/create-bot_keyword.dto';
import { UpdateBotKeywordDto } from './dto/update-bot_keyword.dto';

@Injectable()
export class BotKeywordsService {
  constructor(
    @InjectRepository(BotKeyword)
    private readonly botKeywordRepository: Repository<BotKeyword>,
  ) {}

  async create(whatsappPhone: string, createBotKeywordDto: CreateBotKeywordDto) {
    const botKeyword = this.botKeywordRepository.create({
      ...createBotKeywordDto,
      whatsapp_phone: whatsappPhone, // <-- Asociamos la regla al número de WhatsApp del usuario
    });
    return await this.botKeywordRepository.save(botKeyword);
  }

  async findAllByPhone(whatsappPhone: string) {
    return await this.botKeywordRepository.find({
      where: { whatsapp_phone: whatsappPhone },
    });
  }

  async findOne(id: number) {
    const keyword = await this.botKeywordRepository.findOneBy({ id });
    if (!keyword) {
      throw new NotFoundException(`Palabra clave con ID ${id} no encontrada`);
    }
    return keyword;
  }

  async update(id: number, updateBotKeywordDto: UpdateBotKeywordDto) {
    await this.findOne(id);
    await this.botKeywordRepository.update(id, updateBotKeywordDto);
    return await this.findOne(id);
  }

  async remove(id: number) {
    const keyword = await this.findOne(id);
    return await this.botKeywordRepository.remove(keyword);
  }
}