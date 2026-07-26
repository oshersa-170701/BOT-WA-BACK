import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotKeywordsService } from './bot_keywords.service';
import { BotKeywordsController } from './bot_keywords.controller';
import { BotKeyword } from './entities/bot_keyword.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BotKeyword])],
  controllers: [BotKeywordsController],
  providers: [BotKeywordsService],
})
export class BotKeywordsModule {}