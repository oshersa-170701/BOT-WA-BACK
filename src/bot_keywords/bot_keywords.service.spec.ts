import { Test, TestingModule } from '@nestjs/testing';
import { BotKeywordsService } from './bot_keywords.service';

describe('BotKeywordsService', () => {
  let service: BotKeywordsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BotKeywordsService],
    }).compile();

    service = module.get<BotKeywordsService>(BotKeywordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
