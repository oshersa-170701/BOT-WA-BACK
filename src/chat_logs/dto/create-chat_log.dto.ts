import { IsString, IsNotEmpty } from 'class-validator';

export class CreateChatLogDto {
  @IsString()
  @IsNotEmpty()
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  incoming_message: string;

  @IsString()
  @IsNotEmpty()
  bot_response: string;

  @IsString()
  @IsNotEmpty()
  whatsapp_phone: string;
}