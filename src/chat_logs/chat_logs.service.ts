import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatLog } from './entities/chat_log.entity';
import { CreateChatLogDto } from './dto/create-chat_log.dto';

@Injectable()
export class ChatLogsService {
  constructor(
    @InjectRepository(ChatLog)
    private readonly chatLogRepository: Repository<ChatLog>,
  ) {}

  async create(whatsappPhone: string, createChatLogDto: CreateChatLogDto) {
    const chatLog = this.chatLogRepository.create({
      ...createChatLogDto,
      whatsapp_phone: whatsappPhone, // <-- Asociamos el log al bot correspondiente
    });
    return await this.chatLogRepository.save(chatLog);
  }

  async findAllByPhone(whatsappPhone: string) {
    return await this.chatLogRepository.find({
      where: { whatsapp_phone: whatsappPhone },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number) {
    const chatLog = await this.chatLogRepository.findOneBy({ id });
    if (!chatLog) {
      throw new NotFoundException(`Registro de chat con ID ${id} no encontrado`);
    }
    return chatLog;
  }

  async remove(id: number) {
    const chatLog = await this.findOne(id);
    return await this.chatLogRepository.remove(chatLog);
  }
}