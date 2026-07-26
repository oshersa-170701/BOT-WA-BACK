import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string;

  @Column({ type: 'varchar', length: 50 })
  unit: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  stock: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  price: number;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  sku: string;

  @Column({ type: 'boolean', default: true })
  status: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  
  @Column({ type: 'varchar', length: 150 })
  image_url: string;
  @Column({ type: 'varchar', length: 150 })
  description: string;
  @Column({ type: 'varchar', length: 20 })
  whatsapp_phone: string; // Relacionado al número de celular del usuario
}