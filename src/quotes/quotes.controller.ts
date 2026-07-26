import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  // Crear cotización vinculada al teléfono del bot
  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createQuoteDto: CreateQuoteDto,
  ) {
    return this.quotesService.create(whatsappPhone, createQuoteDto);
  }

  // Listar cotizaciones por teléfono del bot
  @Get('user/:whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.quotesService.findAllByPhone(whatsappPhone);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotesService.findOne(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quotesService.remove(+id);
  }
}