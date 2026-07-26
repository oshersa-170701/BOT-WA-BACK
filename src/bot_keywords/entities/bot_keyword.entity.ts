import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bot_keywords')
export class BotKeyword {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  whatsapp_phone: string; // Relacionado al número de celular del usuario dueño del bot

  @Column({ type: 'varchar', length: 100 }) // <-- Quitamos el unique: true para que cada usuario tenga sus propias palabras
  keyword: string;

  @Column({
    type: 'enum',
    enum: ['exact', 'contains'],
    default: 'contains',
  })
  match_type: 'exact' | 'contains';

  @Column({
    type: 'enum',
    enum: ['text', 'product_search', 'quote'],
    default: 'text',
  })
  response_type: 'text' | 'product_search' | 'quote';

  @Column({ type: 'text' })
  reply_text: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}