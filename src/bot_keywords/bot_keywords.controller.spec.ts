import { Test, TestingModule } from '@nestjs/testing';
import { BotKeywordsController } from './bot_keywords.controller';
import { BotKeywordsService } from './bot_keywords.service';

describe('BotKeywordsController', () => {
  let controller: BotKeywordsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BotKeywordsController],
      providers: [BotKeywordsService],
    }).compile();

    controller = module.get<BotKeywordsController>(BotKeywordsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
