import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

import { Product } from '../products/entities/product.entity';
import { BotKeyword } from '../bot_keywords/entities/bot_keyword.entity';
import { BotSetting } from '../bot_settings/entities/bot_setting.entity';
import { ChatLog } from '../chat_logs/entities/chat_log.entity';
import { Lead } from 'src/leads/lead.entity';

@Injectable()
export class WhatsappService {
  private clients: Map<string, Client> = new Map();
  private latestQrs: Map<string, string> = new Map();
  private initializing: Set<string> = new Set();
  private botStartTimes: Map<string, number> = new Map();

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(BotKeyword)
    private keywordRepository: Repository<BotKeyword>,
    @InjectRepository(BotSetting)
    private settingRepository: Repository<BotSetting>,
    @InjectRepository(ChatLog)
    private chatLogRepository: Repository<ChatLog>,
    @InjectRepository(Lead)
    private leadRepository: Repository<Lead>,
  ) {}

  async initWhatsAppClient(whatsappPhone: string) {
    if (this.initializing.has(whatsappPhone) || this.clients.has(whatsappPhone)) return;
    this.initializing.add(whatsappPhone);
    this.latestQrs.delete(whatsappPhone);
    this.botStartTimes.set(whatsappPhone, Math.floor(Date.now() / 1000));

    try {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: `phone-${whatsappPhone}`,
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ],
        },
      });

      client.on('qr', async (qrText) => {
        try {
          const qrDataUrl = await qrcode.toDataURL(qrText);
          this.latestQrs.set(whatsappPhone, qrDataUrl);
        } catch (err) {
          console.error(`[Teléfono ${whatsappPhone}] Error al convertir QR:`, err);
        }
      });

      client.on('ready', () => {
        console.log(`[Teléfono ${whatsappPhone}] ¡WhatsApp conectado y listo!`);
        this.latestQrs.delete(whatsappPhone);
        this.initializing.delete(whatsappPhone);
        this.botStartTimes.set(whatsappPhone, Math.floor(Date.now() / 1000));
      });

      client.on('authenticated', () => {
        console.log(`[Teléfono ${whatsappPhone}] WhatsApp autenticado correctamente`);
      });

      client.on('message', async (msg: Message) => {
        if (msg.fromMe || msg.isStatus) return;
        const startTime = this.botStartTimes.get(whatsappPhone) || 0;
        if (msg.timestamp && msg.timestamp < startTime) return;
        await this.handleIncomingMessage(whatsappPhone, msg, client);
      });

      client.on('auth_failure', (msg) => {
        console.error(`[Teléfono ${whatsappPhone}] Error de autenticación:`, msg);
        this.latestQrs.delete(whatsappPhone);
        this.initializing.delete(whatsappPhone);
      });

      client.on('disconnected', (reason) => {
        console.log(`[Teléfono ${whatsappPhone}] WhatsApp desconectado:`, reason);
        this.clients.delete(whatsappPhone);
        this.latestQrs.delete(whatsappPhone);
        this.initializing.delete(whatsappPhone);
      });

      this.clients.set(whatsappPhone, client);
      await client.initialize();
    } catch (error) {
      console.error(`[Teléfono ${whatsappPhone}] Error al iniciar el cliente:`, error);
      this.clients.delete(whatsappPhone);
      this.initializing.delete(whatsappPhone);
    }
  }

  private async handleIncomingMessage(whatsappPhone: string, msg: Message, client: Client) {
    try {
      const settings = await this.settingRepository.findOne({ 
        where: { whatsapp_phone: whatsappPhone } 
      });

      if (settings && settings.is_bot_active === false) {
        return;
      }

      if (settings) {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        if (settings.start_time && settings.end_time) {
          if (currentTime < settings.start_time || currentTime > settings.end_time) {
            return;
          }
        }

        if (settings.allowed_days && Array.isArray(settings.allowed_days) && settings.allowed_days.length > 0) {
          const currentDay = now.getDay();
          if (!settings.allowed_days.includes(currentDay)) {
            return;
          }
        }
      }

      const senderNumber = msg.from;
      const incomingText = msg.body ? msg.body.trim() : '';
      if (!incomingText) return;

      let botResponseText = '';

      // 0. VERIFICAR SI ES EL PRIMER MENSAJE DE ESTE NÚMERO (BIENESTAR / BIENVENIDA AUTOMÁTICA)
      const previousChatsCount = await this.chatLogRepository.count({
        where: { phone_number: senderNumber, whatsapp_phone: whatsappPhone }
      });

      if (previousChatsCount === 0) {
        botResponseText = settings?.welcome_message || '¡Hola! Bienvenido a nuestro servicio automático.';
        await msg.reply(botResponseText);

        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return; // Terminamos aquí para saludar corporativamente sin disparar otras reglas de golpe
      }

      // 1. Verificamos si este chat ya fue liberado para un asesor humano (assigned_to_human)
      let lead = await this.leadRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone }
      });

      if (lead && lead.conversation_state === 'assigned_to_human') {
        // El bot ya cumplió su ciclo y está en manos del asesor, no interviene más
        return;
      }

      // 2. Si está en proceso de recopilar el Nombre
      if (lead && lead.conversation_state === 'collecting_name') {
        lead.client_name = incomingText;
        lead.conversation_state = 'collecting_company';
        await this.leadRepository.save(lead);

        botResponseText = `¡Mucho gusto, ${incomingText}! ¿A qué compañía o empresa pertenece?`;
        await msg.reply(botResponseText);
        return;
      }

      // 3. Si está en proceso de recopilar la Empresa / Compañía
      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText;
        lead.conversation_state = 'assigned_to_human'; // <-- Liberamos el chat por completo para el asesor
        await this.leadRepository.save(lead);

        botResponseText = `¡Gracias por la información! En unos momentos un asesor se comunicará contigo.`;
        await msg.reply(botResponseText);
        return;
      }

      // 4. Detectar palabras clave especiales de asociados / representantes / socios / asesor
      // 4.1 COMANDO INTELIGENTE DE AYUDA / MENÚ AUTOMÁTICO
      const lowerText = incomingText.toLowerCase();
      const helpTriggers = ['ayuda', 'menu', 'menú', 'comandos', 'help'];
      
      if (helpTriggers.includes(lowerText)) {
        const activeKeywords = await this.keywordRepository.find({
          where: { whatsapp_phone: whatsappPhone, is_active: true }
        });

        let menuText = ` *${settings?.bot_name || 'Asistente Virtual'}* - Menú de Ayuda:\n\nPuedes escribir los siguientes accesos directos:\n`;
        menuText += `• *Productos* - Ver nuestro catálogo\n`;
        menuText += `• *Asesor* - Hablar con un representante humano\n`;

        if (activeKeywords.length > 0) {
          menuText += ` Palabras clave disponibles:`;
          activeKeywords.forEach(rule => {
            menuText += `• *${rule.keyword}*\n`;
          });
        }

        await msg.reply(menuText);
        
        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: menuText,
          whatsapp_phone: whatsappPhone,
        });
        return;
      }
// 5. Flujo normal de palabras clave guardadas en la base de datos (Catálogos, Textos, etc.)
      const keywords = await this.keywordRepository.find({ 
        where: { whatsapp_phone: whatsappPhone, is_active: true } 
      });
      let matchedRule: BotKeyword | null = null;

      for (const rule of keywords) {
        const kw = rule.keyword.toLowerCase();
        const text = incomingText.toLowerCase();

        if (rule.match_type === 'exact' && text === kw) {
          matchedRule = rule;
          break;
        } else if (rule.match_type === 'contains' && text.includes(kw)) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        if (matchedRule.response_type === 'text') {
          botResponseText = matchedRule.reply_text;
          await msg.reply(botResponseText);
        } else if (matchedRule.response_type === 'product_search') {
          // Buscamos si el usuario escribió exactamente el nombre de un producto para ver su detalle completo
          const specificProduct = await this.productRepository.findOne({
            where: { whatsapp_phone: whatsappPhone, status: true, name: incomingText }
          });

          if (specificProduct) {
            // Si escribió el nombre exacto de un producto, le damos la ficha completa con imagen
            const details = `*${specificProduct.name}*` +
              (specificProduct.brand ? `\nMarca: ${specificProduct.brand}` : '') +
              `\nPrecio: $${specificProduct.price}` +
              `\nStock: ${specificProduct.stock} ${specificProduct.unit || 'pza'}` +
              (specificProduct.description ? `\n${specificProduct.description}` : '');

            if (specificProduct.image_url) {
              try {
                const media = await MessageMedia.fromUrl(specificProduct.image_url, { unsafeMime: true });
                await client.sendMessage(senderNumber, media, { caption: details });
              } catch (imgErr) {
                console.error('Error al enviar imagen:', imgErr);
                await msg.reply(details);
              }
            } else {
              await msg.reply(details);
            }
            botResponseText = `Se enviaron los detalles del producto: ${specificProduct.name}`;
          } else {
            // Si solo escribió la palabra clave (ej. "Productos"), mostramos un listado ligero y resumido de los productos disponibles
            const products = await this.productRepository.find({ 
              where: { whatsapp_phone: whatsappPhone, status: true },
              take: 10 
            });

            if (products.length === 0) {
              botResponseText = 'Lo siento, por el momento no tenemos productos registrados en el catálogo.';
              await msg.reply(botResponseText);
            } else {
              let listText = '📋 *Catálogo de Productos Disponibles*\nEscribe el *nombre exacto* de cualquiera de los siguientes productos para ver su foto y detalles:\n';
              
              products.forEach((prod, index) => {
                listText += `\n${index + 1}. *${prod.name}* - $${prod.price} (${prod.unit || 'pza'})`;
              });

              botResponseText = listText;
              await msg.reply(botResponseText);
            }
          }
        }
      } else {
        // Validación extra: Si el usuario escribió directamente el nombre de un producto sin disparar palabra clave
        const directProduct = await this.productRepository.findOne({
          where: { whatsapp_phone: whatsappPhone, status: true, name: incomingText }
        });

        if (directProduct) {
          const details = `*${directProduct.name}*` +
            (directProduct.brand ? `\nMarca: ${directProduct.brand}` : '') +
            `\nPrecio: $${directProduct.price}` +
            `\nStock: ${directProduct.stock} ${directProduct.unit || 'pza'}` +
            (directProduct.description ? `\n${directProduct.description}` : '');

          if (directProduct.image_url) {
            try {
              const media = await MessageMedia.fromUrl(directProduct.image_url, { unsafeMime: true });
              await client.sendMessage(senderNumber, media, { caption: details });
            } catch (imgErr) {
              await msg.reply(details);
            }
          } else {
            await msg.reply(details);
          }
          botResponseText = `Se envió el detalle directo del producto: ${directProduct.name}`;
        } else {
          botResponseText = settings?.fallback_message || 'Lo siento, no entendí tu mensaje.';
          await msg.reply(botResponseText);
        }
      }

      await this.chatLogRepository.save({
        phone_number: senderNumber,
        incoming_message: incomingText,
        bot_response: botResponseText,
        whatsapp_phone: whatsappPhone,
      });

    } catch (error) {
      console.error('Error procesando mensaje:', error);
    }
  }

  async getQrCode(whatsappPhone: string) {
    const client = this.clients.get(whatsappPhone);
    if (!client && !this.initializing.has(whatsappPhone)) {
      this.initWhatsAppClient(whatsappPhone);
    }

    let attempts = 0;
    while (!this.latestQrs.has(whatsappPhone) && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    const qr = this.latestQrs.get(whatsappPhone);
    if (!qr) {
      return { qr: null, message: 'Generando código QR, por favor espera un momento...' };
    }

    return { qr };
  }

  async disconnectWhatsApp(whatsappPhone: string) {
    try {
      this.latestQrs.delete(whatsappPhone);
      const client = this.clients.get(whatsappPhone);

      if (client) {
        try { await client.logout(); } catch (e) {}
        try { await client.destroy(); } catch (e) {}
        this.clients.delete(whatsappPhone);
      }

      this.initializing.delete(whatsappPhone);
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const authPath = path.resolve(process.cwd(), `.wwebjs_auth/session-phone-${whatsappPhone}`);
      try {
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      } catch (fsErr) {
        console.log('Nota: Carpeta de sesión liberándose gradualmente.');
      }

      return { success: true, message: 'Sesión cerrada correctamente' };
    } catch (error) {
      console.error('Error en disconnectWhatsApp:', error);
      this.initializing.delete(whatsappPhone);
      return { success: false, message: 'Error al cerrar la sesión de WhatsApp' };
    }
  }
}