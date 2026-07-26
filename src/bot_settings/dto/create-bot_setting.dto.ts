import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class CreateBotSettingDto {
  @IsString()
  @IsNotEmpty()
  bot_name: string;

  @IsString()
  @IsOptional()
  welcome_message?: string;

  @IsString()
  @IsOptional()
  fallback_message?: string;

  @IsString()
  @IsNotEmpty()
  whatsapp_phone: string;

  @IsBoolean()
  @IsOptional()
  is_bot_active?: boolean;

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsArray()
  @IsOptional()
  allowed_days?: number[];
}