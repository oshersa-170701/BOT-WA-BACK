import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';

import { Product } from '../products/entities/product.entity';
import { BotKeyword } from '../bot_keywords/entities/bot_keyword.entity';
import { BotSetting } from '../bot_settings/entities/bot_setting.entity';
import { ChatLog } from '../chat_logs/entities/chat_log.entity';
import { Lead } from 'src/leads/lead.entity';
import { Quote } from 'src/quotes/entities/quote.entity';

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
    @InjectRepository(Quote)
    private quoteRepository: Repository<Quote>,
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
      const normalizeStr = (str: string) => 
        str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";

      const cleanIncomingText = normalizeStr(incomingText);

      // 0. VERIFICAR SI ES EL PRIMER MENSAJE DE ESTE NÚMERO (BIENVENIDA AUTOMÁTICA)
      const previousChatsCount = await this.chatLogRepository.count({
        where: { phone_number: senderNumber, whatsapp_phone: whatsappPhone }
      });

      if (previousChatsCount === 0) {
        botResponseText = settings?.welcome_message || '¡Hola! Bienvenido a nuestro servicio automático.\n\nPuedes escribir *Catálogo*, *Cotización* o *Asesor*.';
        await msg.reply(botResponseText);

        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return; 
      }

      // 1. Verificamos si este chat ya fue liberado para un asesor humano (assigned_to_human)
      let lead = await this.leadRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone }
      });

      if (lead && lead.conversation_state === 'assigned_to_human') {
        return;
      }

      // 2. LEAD: Recopilar Nombre
      if (lead && lead.conversation_state === 'collecting_name') {
        lead.client_name = incomingText;
        lead.conversation_state = 'collecting_phone';
        await this.leadRepository.save(lead);

        botResponseText = `¡Mucho gusto, ${incomingText}! Ahora, por favor indícanos un *número telefónico de contacto*:`;
        await msg.reply(botResponseText);
        return;
      }

      // 2.5. LEAD: Recopilar Teléfono personalizado
      if (lead && lead.conversation_state === 'collecting_phone') {
        lead.client_phone = incomingText; // Guardamos el teléfono ingresado por el usuario
        lead.conversation_state = 'collecting_company';
        await this.leadRepository.save(lead);

        botResponseText = `¿A qué compañía, negocio o empresa pertenece?`;
        await msg.reply(botResponseText);
        return;
      }

      // 3. LEAD: Recopilar Empresa / Compañía
      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText;
        lead.conversation_state = 'assigned_to_human'; 
        await this.leadRepository.save(lead);

        botResponseText = `¡Gracias por la información! En unos momentos un asesor, asociado o proveedor se comunicará contigo.`;
        await msg.reply(botResponseText);
        return;
      }

      // 3.5. Detección automática de palabras clave de ASESOR / PROVEEDOR / ASOCIADO
      const advisorTriggers = ['asesor', 'proveedor', 'asociado', 'humano', 'representante'];
      if (advisorTriggers.some(trigger => cleanIncomingText.includes(trigger))) {
        let existingLead = await this.leadRepository.findOne({
          where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone }
        });

        if (!existingLead) {
          existingLead = this.leadRepository.create({
            client_phone: senderNumber,
            whatsapp_phone: whatsappPhone,
            conversation_state: 'collecting_name'
          });
        } else {
          existingLead.conversation_state = 'collecting_name';
        }
        await this.leadRepository.save(existingLead);

        botResponseText = `🤝 Con mucho gusto te comunicaremos con el área correspondiente. Para empezar, por favor indícanos: *¿Cuál es tu nombre?*`;
        await msg.reply(botResponseText);
        return;
      }

      // 4. COTIZACIÓN: Esperando Nombre
      let pendingQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Nombre' }
      });

      if (pendingQuote) {
        pendingQuote.client_name = incomingText;
        pendingQuote.status = 'Esperando Teléfono'; // Pasamos al siguiente paso de pedir teléfono
        await this.quoteRepository.save(pendingQuote);

        botResponseText = `¡Gracias, ${incomingText}! Ahora, por favor indícanos tu *número telefónico de contacto*:`;
        await msg.reply(botResponseText);
        return;
      }

      // 4.5. COTIZACIÓN: Esperando Teléfono personalizado
      let phoneQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Teléfono' }
      });

      if (phoneQuote) {
        phoneQuote.client_phone = incomingText; // Guardamos el teléfono limpio proporcionado
        phoneQuote.status = 'Esperando Productos'; // Siguiente paso para pedir el detalle
        await this.quoteRepository.save(phoneQuote);

        botResponseText = `¡Perfecto! Por último, por favor indícanos qué productos y cantidades necesitas cotizar:`;
        await msg.reply(botResponseText);
        return;
      }

      // 4.6. COTIZACIÓN: Esperando Detalle de Productos
      let activeQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Productos' }
      });

      if (activeQuote) {
        activeQuote.products_requested = incomingText;
        activeQuote.status = 'Pendiente'; // Estatus final visible en el panel como Pendiente de revisión
        activeQuote.total_estimated = 0.00; 
        await this.quoteRepository.save(activeQuote);

        botResponseText = `✅ ¡Cotización registrada con éxito!\n\n📋 *Detalle:* ${incomingText}\n\nUn asesor revisará tu solicitud y te enviará el presupuesto oficial en breve. ¡Gracias!`;
        await msg.reply(botResponseText);
        return;
      }

      // Obtenemos todos los productos activos de la base de datos para las búsquedas
      const allProducts = await this.productRepository.find({
        where: { whatsapp_phone: whatsappPhone, status: true },
        order: { name: 'ASC' }
      });

      // 5. BÚSQUEDA EXACTA DE PRODUCTO POR NOMBRE
      const matchedProduct = allProducts.find(p => normalizeStr(p.name) === cleanIncomingText);

      if (matchedProduct) {
        const details = `*${matchedProduct.name}*` +
          (matchedProduct.brand ? `\nMarca: ${matchedProduct.brand}` : '') +
          `\nPrecio: $${matchedProduct.price}` +
          `\nStock: ${matchedProduct.stock} ${matchedProduct.unit || 'pza'}` +
          (matchedProduct.description ? `\n${matchedProduct.description}` : '');

        if (matchedProduct.image_url) {
          try {
            const media = await MessageMedia.fromUrl(matchedProduct.image_url, { unsafeMime: true });
            await client.sendMessage(senderNumber, media, { caption: details });
          } catch (imgErr) {
            await msg.reply(details);
          }
        } else {
          await msg.reply(details);
        }
        return;
      }

      // 6. DETECCIÓN INTERACTIVA DE CATÁLOGO: FILTRAR POR LETRA O VER TODOS
      if (cleanIncomingText === 'ver todos' || (cleanIncomingText.length === 1 && /^[a-z]$/.test(cleanIncomingText))) {
        let selectedProducts = allProducts;

        if (cleanIncomingText.length === 1) {
          selectedProducts = allProducts.filter(p => normalizeStr(p.name).startsWith(cleanIncomingText));
        }

        if (selectedProducts.length === 0) {
          botResponseText = `❌ No se encontraron productos que inicien con la letra "${incomingText.toUpperCase()}". Intenta con otra letra o escribe "Catálogo".`;
          await msg.reply(botResponseText);
          return;
        }

        let catalogListText = cleanIncomingText === 'ver todos' 
          ? `📋 *Catálogo General (Mostrando primeros 20 nombres)*\nEscribe el nombre exacto de cualquiera para ver su foto, precio y detalles:\n`
          : `🔍 *Productos con la letra "${incomingText.toUpperCase()}" (${selectedProducts.length}):*\nEscribe el nombre exacto para ver sus detalles:\n`;

        selectedProducts.slice(0, 20).forEach((prod) => {
          catalogListText += `\n• ${prod.name}`;
        });

        if (selectedProducts.length > 20) {
          catalogListText += `\n\n*(Y ${selectedProducts.length - 20} productos más... Escribe una letra o nombre específico)*`;
        }

        botResponseText = catalogListText;
        await msg.reply(botResponseText);
        return;
      }

      // 7. FLUJO NORMAL DE PALABRAS CLAVE CONFIGURADAS EN BASE DE DATOS
      const keywords = await this.keywordRepository.find({ 
        where: { whatsapp_phone: whatsappPhone, is_active: true } 
      });
      let matchedRule: BotKeyword | null = null;

      for (const rule of keywords) {
        const kw = normalizeStr(rule.keyword);

        if (rule.match_type === 'exact' && cleanIncomingText === kw) {
          matchedRule = rule;
          break;
        } else if (rule.match_type === 'contains' && cleanIncomingText.includes(kw)) {
          matchedRule = rule;
          break;
        }
      }

      if (matchedRule) {
        if (matchedRule.response_type === 'text') {
          botResponseText = matchedRule.reply_text;
          await msg.reply(botResponseText);
        } else if (matchedRule.response_type === 'quote') {
          botResponseText = `¡Con mucho gusto te ayudamos con tu cotización! 📝\n\nPara empezar, por favor dinos: *¿Cuál es tu nombre?*`;
          await msg.reply(botResponseText);

          await this.quoteRepository.save({
            whatsapp_phone: whatsappPhone,
            client_phone: senderNumber, // Temporal hasta que ingrese su teléfono
            client_name: '',
            products_requested: 'Esperando detalle de productos...',
            total_estimated: 0.00,
            status: 'Esperando Nombre'
          });

        } else if (matchedRule.response_type === 'product_search') {
          const totalProductsCount = allProducts.length;

          botResponseText = `📦 ¡Hola! Actualmente contamos con un total de *${totalProductsCount} productos* registrados en nuestro catálogo.\n\n¿Cómo te gustaría consultarlos?\n\n1️⃣ Escribe *VER TODOS* para listar los nombres.\n2️⃣ O escribe una letra (ej. *A*, *B*, *C*...) para ver únicamente los productos que inician con esa letra.\n\n💡 *Tip:* Una vez que veas el nombre del producto que te interesa, escríbelo tal cual para ver su foto, precio y stock.`;
          await msg.reply(botResponseText);
        }
      } else {
        botResponseText = settings?.fallback_message || 'Lo siento, no entendí tu mensaje.';
        await msg.reply(botResponseText);
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
    // Forzamos una limpieza preventiva si el cliente quedó colgado en memoria
    if (this.clients.has(whatsappPhone)) {
      const client = this.clients.get(whatsappPhone);
      try { await client?.destroy(); } catch (e) {}
      this.clients.delete(whatsappPhone);
    }

    this.latestQrs.delete(whatsappPhone);
    this.initializing.delete(whatsappPhone);

    // Disparamos la inicialización limpia del cliente
    this.initWhatsAppClient(whatsappPhone);

    let attempts = 0;
    while (!this.latestQrs.has(whatsappPhone) && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
      this.botStartTimes.delete(whatsappPhone);
      
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Limpieza profunda de la carpeta de autenticación de whatsapp-web.js
      const authPath = path.resolve(process.cwd(), `.wwebjs_auth/session-phone-${whatsappPhone}`);
      try {
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 1000 });
        }
      } catch (fsErr) {
        console.log('Nota: Los archivos de sesión se están liberando en disco.');
      }

      return { success: true, message: 'Sesión cerrada correctamente' };
    } catch (error) {
      console.error('Error en disconnectWhatsApp:', error);
      this.initializing.delete(whatsappPhone);
      this.clients.delete(whatsappPhone);
      return { success: true, message: 'Sesión restablecida con éxito' };
    }
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