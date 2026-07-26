import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { BotKeywordsModule } from './bot_keywords/bot_keywords.module';
import { BotSettingsModule } from './bot_settings/bot_settings.module';
import { ChatLogsModule } from './chat_logs/chat_logs.module';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: false,
    }),
    ProductsModule,
    BotKeywordsModule,
    BotSettingsModule,
    ChatLogsModule,
    UsersModule,
    WhatsappModule,
  ],
})
export class AppModule {}
