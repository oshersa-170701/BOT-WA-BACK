import { Test, TestingModule } from '@nestjs/testing';
import { BotSettingsController } from './bot_settings.controller';
import { BotSettingsService } from './bot_settings.service';

describe('BotSettingsController', () => {
  let controller: BotSettingsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BotSettingsController],
      providers: [BotSettingsService],
    }).compile();

    controller = module.get<BotSettingsController>(BotSettingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
