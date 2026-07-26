import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotSettingsService } from './bot_settings.service';
import { BotSettingsController } from './bot_settings.controller';
import { BotSetting } from './entities/bot_setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BotSetting])],
  controllers: [BotSettingsController],
  providers: [BotSettingsService],
})
export class BotSettingsModule {}