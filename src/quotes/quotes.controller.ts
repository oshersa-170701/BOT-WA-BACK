import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  // Ocultar listado por POST
  @Post('list')
  async findAllByPhone(@Body() body: { whatsappPhone: string }) {
    return await this.quotesService.findAllByPhone(body.whatsappPhone);
  }

  @Post(':whatsappPhone')
  create(@Param('whatsappPhone') whatsappPhone: string, @Body() createQuoteDto: CreateQuoteDto) {
    return this.quotesService.create(whatsappPhone, createQuoteDto);
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