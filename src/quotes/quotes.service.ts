import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quote } from './entities/quote.entity';

@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(Quote)
    private readonly quoteRepository: Repository<Quote>,
  ) {}

  async create(whatsappPhone: string, createQuoteDto: any) {
    const newQuote = this.quoteRepository.create({
      ...createQuoteDto,
      whatsapp_phone: whatsappPhone,
    });
    return await this.quoteRepository.save(newQuote);
  }

  async findAllByPhone(whatsappPhone: string) {
    return await this.quoteRepository.find({
      where: { whatsapp_phone: whatsappPhone },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number) {
    const quote = await this.quoteRepository.findOneBy({ id });
    if (!quote) {
      throw new NotFoundException(`Cotización con ID ${id} no encontrada`);
    }
    return quote;
  }

  async remove(id: number) {
    const quote = await this.findOne(id);
    return await this.quoteRepository.remove(quote);
  }
  async update(id: number, updateQuoteDto: any) {
    await this.findOne(id);
    await this.quoteRepository.update(id, updateQuoteDto);
    return await this.findOne(id);
  }
}