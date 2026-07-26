import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from './lead.entity';

@Injectable( )
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  // Listar leads asociados al teléfono del bot
  async findAllByPhone(whatsappPhone: string) {
    return await this.leadRepository.find({
      where: { whatsapp_phone: whatsappPhone },
      order: { createdAt: 'DESC' },
    });
  }

  // Eliminar un lead si es necesario
  async remove(id: number) {
    const lead = await this.leadRepository.findOneBy({ id });
    if (!lead) {
      throw new NotFoundException(`Lead con ID ${id} no encontrado`);
    }
    return await this.leadRepository.remove(lead);
  }
}