import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(whatsappPhone: string, createProductDto: CreateProductDto) {
    const product = this.productRepository.create({
      ...createProductDto,
      whatsapp_phone: whatsappPhone, // <-- Asociamos el producto al número de WhatsApp del usuario
    });
    return await this.productRepository.save(product);
  }

  async findAllByPhone(whatsappPhone: string) {
    return await this.productRepository.find({
      where: { whatsapp_phone: whatsappPhone },
    });
  }

  async findOne(id: number) {
    const product = await this.productRepository.findOneBy({ id });
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }
    return product;
  }

  async update(id: number, updateProductDto: UpdateProductDto) {
    await this.findOne(id); // Verifica si existe
    await this.productRepository.update(id, updateProductDto);
    return await this.findOne(id);
  }

  async remove(id: number) {
    const product = await this.findOne(id);
    return await this.productRepository.remove(product);
  }
  async createOrUpdateFromExcel(productData: any) {
    // Si tiene SKU, validamos si ya existe para actualizarlo o crearlo
    if (productData.sku) {
      const existing = await this.productRepository.findOne({
        where: { sku: productData.sku, whatsapp_phone: productData.whatsapp_phone }
      });
      if (existing) {
        await this.productRepository.update(existing.id, productData);
        return;
      }
    }

    // Si no tiene SKU o no existe, lo creamos nuevo
    const newProd = this.productRepository.create(productData);
    await this.productRepository.save(newProd);
  }
}