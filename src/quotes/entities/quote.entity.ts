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

  @Column({ type: 'text', nullable: true })
  products_requested: string; // Detalle acumulado de lo que pidió

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  total_estimated: number; // Precio total calculado

  // 💡 NUEVOS CAMPOS PARA EL FLUJO INTERACTIVO DE COTIZACIÓN
  @Column({ type: 'json', nullable: true })
  search_results_cache: any[]; // Almacena temporalmente los productos encontrados en la búsqueda por similitud

  @Column({ type: 'int', nullable: true })
  pending_product_id: number; // ID del producto seleccionado temporalmente

  @Column({ type: 'varchar', length: 255, nullable: true })
  pending_product_name: string; // Nombre del producto pendiente de confirmar

  @Column({ type: 'int', nullable: true })
  pending_quantity: number; // Cantidad pendiente de confirmar

@Column({ type: 'varchar', nullable: true })
contact_phone: string;


  @Column({ type: 'varchar', length: 50, default: 'Pendiente' })
  status: string; // 'Esperando Nombre', 'Esperando Teléfono', 'Esperando Producto', 'Confirmando Producto', 'Confirmando Cantidad', 'Preguntar Otro Producto', 'Pendiente'
  
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}