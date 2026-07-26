import { Test, TestingModule } from '@nestjs/testing';
import { BotSettingsService } from './bot_settings.service';

describe('BotSettingsService', () => {
  let service: BotSettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BotSettingsService],
    }).compile();

    service = module.get<BotSettingsService>(BotSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
