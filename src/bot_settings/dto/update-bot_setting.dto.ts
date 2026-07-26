import { PartialType } from '@nestjs/mapped-types';
import { CreateBotSettingDto } from './create-bot_setting.dto';

export class UpdateBotSettingDto extends PartialType(CreateBotSettingDto) {}
