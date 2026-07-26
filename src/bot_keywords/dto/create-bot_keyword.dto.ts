import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean } from 'class-validator';

export class CreateBotKeywordDto {
  @IsString()
  @IsNotEmpty()
  keyword: string;

  @IsEnum(['exact', 'contains'])
  @IsOptional()
  match_type?: 'exact' | 'contains';

  @IsEnum(['text', 'product_search', 'quote'])
  @IsOptional()
  response_type?: 'text' | 'product_search' | 'quote';

  @IsString()
  @IsNotEmpty()
  reply_text: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean; 

  @IsString()
  @IsNotEmpty()
  whatsapp_phone: string;
}