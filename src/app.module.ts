import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from './products/products.module';
import { BotKeywordsModule } from './bot_keywords/bot_keywords.module';
import { BotSettingsModule } from './bot_settings/bot_settings.module';
import { ChatLogsModule } from './chat_logs/chat_logs.module';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { QuotesModule } from './quotes/quotes.module';
import { LeadsModule } from './leads/leads.module';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 20,
    }]),
    ConfigModule.forRoot({ isGlobal: true }),
  TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.MYSQLHOST || 'localhost',
      port: parseInt(process.env.MYSQLPORT || '3306', 10),
      username: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || '',
      database: process.env.MYSQLDATABASE || 'railway', // Toma 'railway' desde las variables del panel
      autoLoadEntities: true,
      synchronize: true, 
    }),
    ProductsModule,
    BotKeywordsModule,
    BotSettingsModule,
    ChatLogsModule,
    UsersModule,
    WhatsappModule,
    QuotesModule,
    LeadsModule,
  ],
})
export class AppModule {}