import { Controller, Post, UploadedFile, UseInterceptors, Param, Body, Get, Patch, Delete } from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post(':whatsappPhone')
  create(
    @Param('whatsappPhone') whatsappPhone: string,
    @Body() createProductDto: any,
  ) {
    return this.productsService.create(whatsappPhone, createProductDto);
  }

  @Get('user/:whatsappPhone')
  findAllByPhone(@Param('whatsappPhone') whatsappPhone: string) {
    return this.productsService.findAllByPhone(whatsappPhone);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: any) {
    return this.productsService.update(+id, updateProductDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(+id);
  }

  // Nuevo endpoint para carga masiva por Excel
  @Post('upload-excel/:whatsappPhone')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @Param('whatsappPhone') whatsappPhone: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      return {
        success: false,
        message: 'No se ha proporcionado ningún archivo',
      };
    }

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheetData: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      let importedCount = 0;

      for (const row of sheetData) {
        // Mapeamos exactamente con los nombres de tus columnas de Excel en inglés/minúsculas
        const name = row['name'] || row['Nombre'];
        if (!name) continue; // Si no tiene nombre, se salta la fila

        // Limpiamos y validamos el SKU para evitar conflictos de índice único si viene vacío
        let skuVal = row['sku'] || row['SKU'] || null;
        if (skuVal !== null) {
          skuVal = String(skuVal).trim();
          if (skuVal === '' || skuVal.toUpperCase() === 'NULL') {
            skuVal = null;
          }
        }

        const productData = {
          name: String(name).trim(),
          brand: row['brand'] || row['Marca'] || '',
          price: Number(row['price'] || row['Precio'] || 0),
          category: row['category'] || row['Categoría'] || '',
          stock: Number(row['stock'] || row['Stock'] || 0),
          unit: row['unit'] || row['Unidad'] || 'pza',
          sku: skuVal,
          description: row['description'] || row['Descripción'] || '',
          image_url: row['image_url'] || row['Imagen'] || '',
          whatsapp_phone: whatsappPhone,
          status: 1, // Tu base de datos usa TINYINT para status
        };

        await this.productsService.createOrUpdateFromExcel(productData);
        importedCount++;
      }

      return { 
        success: true, 
        message: `Se importaron ${importedCount} productos exitosamente.` 
      };
    } catch (error) {
      console.error('Error al procesar el Excel:', error);
      return { success: false, message: 'Error al procesar el archivo Excel' };
    }
  }
}