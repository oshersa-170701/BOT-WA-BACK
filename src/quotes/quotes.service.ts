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
    const quotes = await this.quoteRepository.find({
      where: { whatsapp_phone: whatsappPhone },
      order: { createdAt: 'DESC' },
    });

    // "phone_display" es lo que el panel debe pintar en la columna TELÉFONO:
    // el número que el cliente escribió a mano (contact_phone). Si aún no
    // lo ha dado (está a mitad del flujo), mostramos el JID real como
    // respaldo para no dejar la columna vacía.
    return quotes.map((quote) => ({
      ...quote,
      phone_display: quote.contact_phone || quote.client_phone,
    }));
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