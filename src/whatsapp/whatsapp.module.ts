import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { Product } from '../products/entities/product.entity';
import { BotKeyword } from '../bot_keywords/entities/bot_keyword.entity';
import { BotSetting } from '../bot_settings/entities/bot_setting.entity';
import { ChatLog } from '../chat_logs/entities/chat_log.entity';
import { WhatsappController } from './whatsapp.controller';
import { Lead } from 'src/leads/lead.entity';
import { Quote } from 'src/quotes/entities/quote.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      BotKeyword,
      BotSetting,
      ChatLog,
      Lead,
      Quote,
    ]),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}