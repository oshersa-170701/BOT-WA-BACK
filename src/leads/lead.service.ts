import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from './lead.entity';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  // Listar leads asociados al teléfono del bot
  async findAllByPhone(whatsappPhone: string) {
    const leads = await this.leadRepository.find({
      where: { whatsapp_phone: whatsappPhone },
      order: { createdAt: 'DESC' },
    });

    // "phone_display" es lo que el panel debe pintar en la columna TELÉFONO:
    // el número que el cliente escribió a mano (contact_phone). Si aún no
    // lo ha dado (está a mitad del flujo), mostramos el JID real como
    // respaldo para no dejar la columna vacía.
    return leads.map((lead) => ({
      ...lead,
      phone_display: lead.contact_phone || lead.client_phone,
    }));
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