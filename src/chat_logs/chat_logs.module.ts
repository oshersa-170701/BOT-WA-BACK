import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatLogsService } from './chat_logs.service';
import { ChatLogsController } from './chat_logs.controller';
import { ChatLog } from './entities/chat_log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ChatLog])],
  controllers: [ChatLogsController],
  providers: [ChatLogsService],
})
export class ChatLogsModule {}