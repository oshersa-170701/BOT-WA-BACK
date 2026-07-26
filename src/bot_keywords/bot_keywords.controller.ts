import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { BotKeywordsService } from './bot_keywords.service';
import { CreateBotKeywordDto } from './dto/create-bot_keyword.dto';
import { UpdateBotKeywordDto } from './dto/update-bot_keyword.dto';

@Controller('bot-keywords')
export class BotKeywordsController {
  constructor(private readonly botKeywordsService: BotKeywordsService) {}

  // Crear palabra clave vinculada al teléfono del usuario
  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createBotKeywordDto: CreateBotKeywordDto,
  ) {
    return this.botKeywordsService.create(whatsappPhone, createBotKeywordDto);
  }

  // Listar todas las palabras clave de un usuario específico
  @Get('user/:whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.botKeywordsService.findAllByPhone(whatsappPhone);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.botKeywordsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBotKeywordDto: UpdateBotKeywordDto,
  ) {
    return this.botKeywordsService.update(+id, updateBotKeywordDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.botKeywordsService.remove(+id);
  }
}