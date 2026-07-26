import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('bot_settings')
export class BotSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100, default: 'Asistente Virtual' })
  bot_name: string;

  @Column({ type: 'text', nullable: true })
  welcome_message: string;

  @Column({ type: 'text', nullable: true })
  fallback_message: string;

  @Column({ type: 'boolean', default: true })
  is_bot_active: boolean;

  @Column({ type: 'varchar', length: 50, default: '08:00' })
  start_time: string;

  @Column({ type: 'varchar', length: 50, default: '18:00' })
  end_time: string;

  // Transformador inteligente para guardar el arreglo como texto plano en tu VARCHAR de MySQL
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    transformer: {
      to(value: number[]): string {
        return value ? value.join(',') : '';
      },
      from(value: string): number[] {
        return value ? value.split(',').map(v => parseInt(v, 10)) : [];
      },
    },
  })
  allowed_days: number[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'varchar', length: 20, unique: true })
  whatsapp_phone: string;
}