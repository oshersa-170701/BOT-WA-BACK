import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';

import { Product } from '../products/entities/product.entity';
import { BotKeyword } from '../bot_keywords/entities/bot_keyword.entity';
import { BotSetting } from '../bot_settings/entities/bot_setting.entity';
import { ChatLog } from '../chat_logs/entities/chat_log.entity';
import { Lead } from 'src/leads/lead.entity';
import { Quote } from 'src/quotes/entities/quote.entity';

@Injectable()
export class WhatsappService {
  private sessions: Map<string, any> = new Map();
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
    if (this.initializing.has(whatsappPhone) || this.sessions.has(whatsappPhone)) return;
    this.initializing.add(whatsappPhone);
    this.latestQrs.delete(whatsappPhone);
    this.botStartTimes.set(whatsappPhone, Math.floor(Date.now() / 1000));

    try {
      const authFolder = path.resolve(process.cwd(), `baileys_auth/session-${whatsappPhone}`);
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }) as any,
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
          try {
            const qrDataUrl = await qrcode.toDataURL(qr);
            this.latestQrs.set(whatsappPhone, qrDataUrl);
          } catch (err) {
            console.error(`[Teléfono ${whatsappPhone}] Error al convertir QR:`, err);
          }
        }

        if (connection === 'open') {
          console.log(`[Teléfono ${whatsappPhone}] ¡WhatsApp conectado y listo con Baileys!`);
          this.latestQrs.delete(whatsappPhone);
          this.initializing.delete(whatsappPhone);
          this.botStartTimes.set(whatsappPhone, Math.floor(Date.now() / 1000));
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`[Teléfono ${whatsappPhone}] WhatsApp desconectado. Reconectando:`, shouldReconnect);
          this.sessions.delete(whatsappPhone);
          this.latestQrs.delete(whatsappPhone);
          this.initializing.delete(whatsappPhone);
          if (shouldReconnect) {
            this.initWhatsAppClient(whatsappPhone);
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;
        if (!senderNumber || senderNumber.includes('@g.us')) return; // Ignorar grupos

        const messageTimestamp = typeof msg.messageTimestamp === 'number' 
          ? msg.messageTimestamp 
          : Number(msg.messageTimestamp || 0);

        const startTime = this.botStartTimes.get(whatsappPhone) || 0;
        if (messageTimestamp && messageTimestamp < startTime) return;

        await this.handleIncomingMessage(whatsappPhone, msg, sock);
      });

      this.sessions.set(whatsappPhone, sock);
      this.initializing.delete(whatsappPhone);
    } catch (error) {
      console.error(`[Teléfono ${whatsappPhone}] Error al iniciar cliente Baileys:`, error);
      this.sessions.delete(whatsappPhone);
      this.initializing.delete(whatsappPhone);
    }
  }

  private async handleIncomingMessage(whatsappPhone: string, msg: any, sock: any) {
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

      const senderNumber = msg.key.remoteJid;
      const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const incomingText = messageContent.trim();
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
        await sock.sendMessage(senderNumber, { text: botResponseText });

        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return;
      }

      // 1. Verificamos si este chat ya fue liberado para un asesor humano
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
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 2.5. LEAD: Recopilar Teléfono
      if (lead && lead.conversation_state === 'collecting_phone') {
        lead.client_phone = incomingText;
        lead.conversation_state = 'collecting_company';
        await this.leadRepository.save(lead);

        botResponseText = `¿A qué compañía, negocio o empresa pertenece?`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 3. LEAD: Recopilar Empresa
      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText;
        lead.conversation_state = 'assigned_to_human';
        await this.leadRepository.save(lead);

        botResponseText = `¡Gracias por la información! En unos momentos un asesor, asociado o proveedor se comunicará contigo.`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 3.5. Detección automática de ASESOR
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
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 4. COTIZACIÓN: Flujo paso a paso
      let pendingQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Nombre' }
      });

      if (pendingQuote) {
        pendingQuote.client_name = incomingText;
        pendingQuote.status = 'Esperando Teléfono';
        await this.quoteRepository.save(pendingQuote);

        botResponseText = `¡Gracias, ${incomingText}! Ahora, por favor indícanos tu *número telefónico de contacto*:`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      let phoneQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Teléfono' }
      });

      if (phoneQuote) {
        phoneQuote.client_phone = incomingText;
        phoneQuote.status = 'Esperando Productos';
        await this.quoteRepository.save(phoneQuote);

        botResponseText = `¡Perfecto! Por último, por favor indícanos qué productos y cantidades necesitas cotizar:`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      let activeQuote = await this.quoteRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone, status: 'Esperando Productos' }
      });

      if (activeQuote) {
        activeQuote.products_requested = incomingText;
        activeQuote.status = 'Pendiente';
        activeQuote.total_estimated = 0.00;
        await this.quoteRepository.save(activeQuote);

        botResponseText = `✅ ¡Cotización registrada con éxito!\n\n📋 *Detalle:* ${incomingText}\n\nUn asesor revisará tu solicitud y te enviará el presupuesto oficial en breve. ¡Gracias!`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      const allProducts = await this.productRepository.find({
        where: { whatsapp_phone: whatsappPhone, status: true },
        order: { name: 'ASC' }
      });

      // 5. BÚSQUEDA EXACTA DE PRODUCTO
      const matchedProduct = allProducts.find(p => normalizeStr(p.name) === cleanIncomingText);

      if (matchedProduct) {
        const details = `*${matchedProduct.name}*` +
          (matchedProduct.brand ? `\nMarca: ${matchedProduct.brand}` : '') +
          `\nPrecio: $${matchedProduct.price}` +
          `\nStock: ${matchedProduct.stock} ${matchedProduct.unit || 'pza'}` +
          (matchedProduct.description ? `\n${matchedProduct.description}` : '');

        await sock.sendMessage(senderNumber, { text: details });
        return;
      }

      // 6. CATÁLOGO INTERACTIVO
      if (cleanIncomingText === 'ver todos' || (cleanIncomingText.length === 1 && /^[a-z]$/.test(cleanIncomingText))) {
        let selectedProducts = allProducts;

        if (cleanIncomingText.length === 1) {
          selectedProducts = allProducts.filter(p => normalizeStr(p.name).startsWith(cleanIncomingText));
        }

        if (selectedProducts.length === 0) {
          botResponseText = `❌ No se encontraron productos que inicien con la letra "${incomingText.toUpperCase()}". Intenta con otra letra o escribe "Catálogo".`;
          await sock.sendMessage(senderNumber, { text: botResponseText });
          return;
        }

        let catalogListText = cleanIncomingText === 'ver todos'
          ? `📋 *Catálogo General (Mostrando primeros 20 nombres)*\nEscribe el nombre exacto de cualquiera para ver su precio y detalles:\n`
          : `🔍 *Productos con la letra "${incomingText.toUpperCase()}" (${selectedProducts.length}):*\nEscribe el nombre exacto para ver sus detalles:\n`;

        selectedProducts.slice(0, 20).forEach((prod) => {
          catalogListText += `\n• ${prod.name}`;
        });

        if (selectedProducts.length > 20) {
          catalogListText += `\n\n*(Y ${selectedProducts.length - 20} productos más...)*`;
        }

        botResponseText = catalogListText;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 7. PALABRAS CLAVE
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
          await sock.sendMessage(senderNumber, { text: botResponseText });
        } else if (matchedRule.response_type === 'quote') {
          botResponseText = `¡Con mucho gusto te ayudamos con tu cotización! 📝\n\nPara empezar, por favor dinos: *¿Cuál es tu nombre?*`;
          await sock.sendMessage(senderNumber, { text: botResponseText });

          await this.quoteRepository.save({
            whatsapp_phone: whatsappPhone,
            client_phone: senderNumber,
            client_name: '',
            products_requested: 'Esperando detalle de productos...',
            total_estimated: 0.00,
            status: 'Esperando Nombre'
          });
        } else if (matchedRule.response_type === 'product_search') {
          const totalProductsCount = allProducts.length;
          botResponseText = `📦 ¡Hola! Actualmente contamos con un total de *${totalProductsCount} productos* registrados.\n\nEscribe *VER TODOS* o una letra (ej. *A*, *B*...) para filtrar el catálogo.`;
          await sock.sendMessage(senderNumber, { text: botResponseText });
        }
      } else {
        botResponseText = settings?.fallback_message || 'Lo siento, no entendí tu mensaje.';
        await sock.sendMessage(senderNumber, { text: botResponseText });
      }

      await this.chatLogRepository.save({
        phone_number: senderNumber,
        incoming_message: incomingText,
        bot_response: botResponseText,
        whatsapp_phone: whatsappPhone,
      });

    } catch (error) {
      console.error('Error procesando mensaje con Baileys:', error);
    }
  }

  async getQrCode(whatsappPhone: string) {
    if (!this.sessions.has(whatsappPhone) && !this.initializing.has(whatsappPhone)) {
      this.initWhatsAppClient(whatsappPhone);
    }

    let attempts = 0;
    while (!this.latestQrs.has(whatsappPhone) && attempts < 12) {
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
      const sock = this.sessions.get(whatsappPhone);

      if (sock) {
        try { await sock.logout(); } catch (e) {}
        this.sessions.delete(whatsappPhone);
      }

      this.initializing.delete(whatsappPhone);
      this.botStartTimes.delete(whatsappPhone);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const authFolder = path.resolve(process.cwd(), `baileys_auth/session-${whatsappPhone}`);
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
      }

      return { success: true, message: 'Sesión cerrada correctamente' };
    } catch (error) {
      console.error('Error en disconnectWhatsApp:', error);
      return { success: true, message: 'Sesión reiniciada con éxito' };
    }
  }
}