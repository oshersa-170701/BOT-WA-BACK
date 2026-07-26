import { Controller, Get, Param, Delete } from '@nestjs/common';
import { LeadsService } from './lead.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('user/:whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.leadsService.findAllByPhone(whatsappPhone);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leadsService.remove(+id);
  }
}