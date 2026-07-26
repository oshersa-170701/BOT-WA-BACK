import { Test, TestingModule } from '@nestjs/testing';
import { ChatLogsController } from './chat_logs.controller';
import { ChatLogsService } from './chat_logs.service';

describe('ChatLogsController', () => {
  let controller: ChatLogsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatLogsController],
      providers: [ChatLogsService],
    }).compile();

    controller = module.get<ChatLogsController>(ChatLogsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
