import { Controller, Get, Param, Delete } from '@nestjs/common';
import { LeadsService } from './lead.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('user/:whatsappPhone')
  async findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return await this.leadsService.findAllByPhone(whatsappPhone);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.leadsService.remove(+id);
  }
}