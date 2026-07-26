import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Crear producto vinculado al teléfono del usuario
  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createProductDto: CreateProductDto,
  ) {
    return this.productsService.create(whatsappPhone, createProductDto);
  }

  // Listar todos los productos exclusivos de este número de bot
  @Get('user/:whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.productsService.findAllByPhone(whatsappPhone);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(+id, updateProductDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }
}