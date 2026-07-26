import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  whatsapp_phone: string; // Número del bot dueño de la cotización

  @Column({ type: 'varchar', length: 50 })
  client_phone: string; // Número de WhatsApp del cliente que cotiza

  @Column({ type: 'varchar', length: 150, nullable: true, default: 'Cliente' })
  client_name: string;

  @Column({ type: 'text' })
  products_requested: string; // Detalle de lo que pidió

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  total_estimated: number; // Precio total calculado

  @Column({ type: 'varchar', length: 50, default: 'Pendiente' })
  status: string; // Pendiente, Respondida, etc.

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}