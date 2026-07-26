import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50 })
  client_phone: string; // Número de WhatsApp del cliente final

  @Column({ type: 'varchar', length: 20 })
  whatsapp_phone: string; // Número del bot/empresa

  @Column({ type: 'varchar', length: 150, nullable: true })
  client_name: string; // Nombre capturado

  @Column({ type: 'varchar', length: 150, nullable: true })
  company_name: string; // Empresa capturada

  // Estados: 'collecting_name', 'collecting_company', 'assigned_to_human'
  @Column({ type: 'varchar', length: 50, default: 'collecting_name' })
  conversation_state: string; 

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}