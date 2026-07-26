import { PartialType } from '@nestjs/mapped-types';
import { CreateBotKeywordDto } from './create-bot_keyword.dto';

export class UpdateBotKeywordDto extends PartialType(CreateBotKeywordDto) {}
