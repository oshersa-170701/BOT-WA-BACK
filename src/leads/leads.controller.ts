import { Controller, Post, Body, Delete, Param } from '@nestjs/common';
import { LeadsService } from './lead.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // Ocultar listado por POST
  @Post('list')
  async findAllByPhone(@Body() body: { whatsappPhone: string }) {
    return await this.leadsService.findAllByPhone(body.whatsappPhone);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.leadsService.remove(+id);
  }
}