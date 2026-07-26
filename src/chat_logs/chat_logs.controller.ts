import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { ChatLogsService } from './chat_logs.service';
import { CreateChatLogDto } from './dto/create-chat_log.dto';

@Controller('chat-logs')
export class ChatLogsController {
  constructor(private readonly chatLogsService: ChatLogsService) {}

  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createChatLogDto: CreateChatLogDto,
  ) {
    return this.chatLogsService.create(whatsappPhone, createChatLogDto);
  }

  // Obtener únicamente el historial de chats de este número de bot
  @Get(':whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.chatLogsService.findAllByPhone(whatsappPhone);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.chatLogsService.remove(+id);
  }
}