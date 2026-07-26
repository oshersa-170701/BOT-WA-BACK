import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('chat_logs')
export class ChatLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50 })
  phone_number: string;

  @Column({ type: 'text' })
  incoming_message: string;

  @Column({ type: 'text' })
  bot_response: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 20 })
  whatsapp_phone: string; // El número de la empresa/bot dueño del chat
}