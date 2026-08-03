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
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'www'),
      // Excluimos las rutas de la API para que no sean interceptadas por los archivos estáticos
      exclude: [
        '/users*',
        '/products*',
        '/bot-keywords*',
        '/bot-settings*',
        '/chat-logs*',
        '/whatsapp*',
        '/quotes*',
        '/leads*',
      ],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 20,
      },
    ]),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
      port: parseInt(
        process.env.MYSQLPORT || process.env.DB_PORT || '3306',
        10,
      ),
      username: process.env.MYSQLUSER || process.env.DB_USER,
      password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
      database:
        process.env.MYSQL_DATABASE ||
        process.env.MYSQLDATABASE ||
        process.env.DB_NAME,
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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}