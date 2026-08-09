import { Injectable, OnModuleInit } from '@nestjs/common';
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
export class WhatsappService implements OnModuleInit {
  private sessions: Map<string, any> = new Map();
  private latestQrs: Map<string, string> = new Map();
  private initializing: Set<string> = new Set();
  private botStartTimes: Map<string, number> = new Map();
  private catalogPages: Map<string, number> = new Map();

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
  ) { }

  async onModuleInit() {
    try {
      const baseAuthDir = path.resolve(process.cwd(), 'baileys_auth');
      if (fs.existsSync(baseAuthDir)) {
        const folders = fs.readdirSync(baseAuthDir);
        for (const folder of folders) {
          if (folder.startsWith('session-')) {
            const whatsappPhone = folder.replace('session-', '');
            const credsPath = path.resolve(baseAuthDir, folder, 'creds.json');
            if (fs.existsSync(credsPath)) {
              console.log(`[Auto-Restauración] Encontrada sesión activa en disco para: ${whatsappPhone}. Levantando socket...`);
              this.initWhatsAppClient(whatsappPhone);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error auto-restaurando sesiones de WhatsApp:', e);
    }
  }

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
          this.sessions.set(whatsappPhone, sock);
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          this.sessions.delete(whatsappPhone);
          this.latestQrs.delete(whatsappPhone);
          this.initializing.delete(whatsappPhone);

          if (statusCode === DisconnectReason.loggedOut) {
            if (fs.existsSync(authFolder)) {
              fs.rmSync(authFolder, { recursive: true, force: true });
            }
          } else if (shouldReconnect) {
            setTimeout(() => {
              this.initWhatsAppClient(whatsappPhone);
            }, 3000);
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderNumber = msg.key.remoteJid;
        if (!senderNumber || senderNumber.includes('@g.us') || senderNumber.includes('status')) return; 

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

      // 1. Verificar si el chat ya fue asignado a un asesor humano o finalizado
      let lead = await this.leadRepository.findOne({
        where: { client_phone: senderNumber, whatsapp_phone: whatsappPhone }
      });

      // 2. LEAD: Recopilar Nombre
      if (lead && lead.conversation_state === 'collecting_name') {
        lead.client_name = incomingText;
        lead.conversation_state = 'collecting_phone'; // 👈 Pasamos a pedir el teléfono de contacto
        await this.leadRepository.save(lead);

        botResponseText = `¡Mucho gusto, ${incomingText}! Ahora, por favor indícanos un *número telefónico de contacto*:`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 2.5. LEAD: Recopilar Teléfono
      if (lead && lead.conversation_state === 'collecting_phone') {
        lead.client_phone = incomingText; // 👈 Guardamos el teléfono que escribió
        lead.conversation_state = 'collecting_company'; // 👈 Pasamos al siguiente paso para pedir la empresa
        await this.leadRepository.save(lead);

        botResponseText = `¿A qué compañía, negocio o empresa pertenece?`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 3. LEAD: Recopilar Empresa y TERMINAR CHAT PARA DAR PASO AL ASESOR
      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText; // 👈 Guardamos correctamente el nombre de la empresa/negocio
        lead.conversation_state = 'assigned_to_human'; // 👈 El bot termina el chat y cede el control al asesor
        await this.leadRepository.save(lead);

        botResponseText = `✅ ¡Información registrada con éxito!\n\n🤝 En unos momentos un asesor, asociado o proveedor se comunicará contigo para continuar la conversación. ¡Gracias por tu paciencia!`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 2. COMANDO PARA TERMINAR SESIÓN / CERRAR CHAT MANUALMENTE
      const endSessionTriggers = ['salir', 'terminar', 'adios', 'adiós', 'finalizar', 'gracias'];
      if (endSessionTriggers.some(trigger => cleanIncomingText === trigger)) {
        botResponseText = `👋 Sesión finalizada. Gracias por comunicarte con nosotros. Si necesitas algo más, solo escribe *Hola* o *Catálogo* en cualquier momento para iniciar de nuevo.`;
        await sock.sendMessage(senderNumber, { text: botResponseText });

        // Marcamos como asignado a humano/finalizado para silenciar al bot hasta que vuelva a saludar
        if (!lead) {
          lead = this.leadRepository.create({
            client_phone: senderNumber,
            whatsapp_phone: whatsappPhone,
            conversation_state: 'assigned_to_human'
          });
        } else {
          lead.conversation_state = 'assigned_to_human';
        }
        await this.leadRepository.save(lead);
        return;
      }

      // 0. VERIFICAR SI ES EL PRIMER MENSAJE (BIENVENIDA AUTOMÁTICA)
      const previousChatsCount = await this.chatLogRepository.count({
        where: { phone_number: senderNumber, whatsapp_phone: whatsappPhone }
      });

      if (previousChatsCount === 0 || cleanIncomingText === 'hola') {
        botResponseText = settings?.welcome_message || '¡Hola! Bienvenido a nuestro servicio automático.\n\nPuedes escribir *Catálogo*, *Cotización* o *Asesor*.';
        await sock.sendMessage(senderNumber, { text: botResponseText });

        if (lead) {
          lead.conversation_state = 'active';
          await this.leadRepository.save(lead);
        }

        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
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

      // 3. LEAD: Recopilar Empresa y TERMINAR CHAT PARA DAR PASO AL ASESOR
      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText;
        lead.conversation_state = 'assigned_to_human'; // 👈 El bot termina el chat y cede el control al asesor
        await this.leadRepository.save(lead);

        botResponseText = `✅ ¡Información registrada con éxito!\n\n🤝 En unos momentos un asesor, asociado o proveedor se comunicará contigo para continuar la conversación. ¡Gracias por tu paciencia!`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 3.5. Detección automática de ASESOR / ASOCIADO
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

        botResponseText = `🤝 Con mucho gusto te comunicaremos con un asociado o asesor humano. Para empezar, por favor indícanos: *¿Cuál es tu nombre?*`;
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

        botResponseText = `✅ ¡Cotización registrada con éxito!\n\n📋 *Detalle:* ${incomingText}\n\nUn asesor revisará tu solicitud y te enviará el presupuesto oficial en breve. ¿Deseas *terminar* la sesión o necesitas ver algo más?`;
        await sock.sendMessage(senderNumber, { text: botResponseText });
        return;
      }

      // 5. EVALUAR PALABRAS CLAVE CONFIGURADAS
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
          this.catalogPages.set(senderNumber, 0);
          await this.sendCatalogPage(whatsappPhone, senderNumber, sock, 0);
          return;
        }

        await this.chatLogRepository.save({
          phone_number: senderNumber,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return;
      }

      // 6. CARGAR PRODUCTOS PARA BÚSQUEDA SECUNDARIA
      const allProducts = await this.productRepository.find({
        where: { whatsapp_phone: whatsappPhone, status: true },
        order: { name: 'ASC' }
      });

      // 6.0. COMANDO "SIGUIENTE" O "MÁS" EN CATÁLOGO
      if (cleanIncomingText === 'siguiente' || cleanIncomingText === 'mas' || cleanIncomingText === 'más') {
        let currentPage = this.catalogPages.get(senderNumber) || 0;
        currentPage++;
        
        const maxPages = Math.ceil(allProducts.length / 12);
        if (currentPage >= maxPages) {
          currentPage = 0;
        }

        this.catalogPages.set(senderNumber, currentPage);
        await this.sendCatalogPage(whatsappPhone, senderNumber, sock, currentPage);
        return;
      }

      // 6.1. BÚSQUEDA EXACTA O POR NÚMERO DE LISTA
      let matchedProduct: Product | undefined = undefined;

      if (/^\d+$/.test(cleanIncomingText)) {
        const index = parseInt(cleanIncomingText, 10) - 1;
        const currentPage = this.catalogPages.get(senderNumber) || 0;
        const pagedProducts = allProducts.slice(currentPage * 12, (currentPage + 1) * 12);
        if (index >= 0 && index < pagedProducts.length) {
          matchedProduct = pagedProducts[index];
        }
      } else {
        matchedProduct = allProducts.find(p => normalizeStr(p.name) === cleanIncomingText);
      }

      if (matchedProduct) {
        const details = `*${matchedProduct.name}*` +
          (matchedProduct.brand ? `\nMarca: ${matchedProduct.brand}` : '') +
          `\nPrecio: $${matchedProduct.price}` +
          `\nStock: ${matchedProduct.stock} ${matchedProduct.unit || 'pza'}` +
          (matchedProduct.description ? `\n${matchedProduct.description}` : '');

        if (matchedProduct.image_url && matchedProduct.image_url.startsWith('http')) {
          await sock.sendMessage(senderNumber, { 
            image: { url: matchedProduct.image_url }, 
            caption: details + `\n\n*(Escribe "Siguiente" para ver más catálogo o "Terminar" para cerrar chat)*`
          });
        } else {
          await sock.sendMessage(senderNumber, { text: details + `\n\n*(Escribe "Siguiente" para ver más catálogo o "Terminar" para cerrar chat)*` });
        }
        return;
      }

      // 6.2. BÚSQUEDA POR CATEGORÍA O PARCIAL
      const matchedByCategoryOrPartial = allProducts.filter(p => 
        (p.category && normalizeStr(p.category).includes(cleanIncomingText)) ||
        (p.name && normalizeStr(p.name).includes(cleanIncomingText))
      );

      if (matchedByCategoryOrPartial.length > 0 && cleanIncomingText.length > 2) {
        let categoryResultsText = `🔍 *Encontramos ${matchedByCategoryOrPartial.length} productos:* \n\nEscribe el número o nombre exacto:\n`;

        matchedByCategoryOrPartial.slice(0, 12).forEach((prod, idx) => {
          categoryResultsText += `\n${idx + 1}. ${prod.name} ($${prod.price})`;
        });

        await sock.sendMessage(senderNumber, { text: categoryResultsText });
        return;
      }

      // 6.3. COMANDO "VER TODOS"
      if (cleanIncomingText === 'ver todos' || (cleanIncomingText.length === 1 && /^[a-z]$/.test(cleanIncomingText))) {
        this.catalogPages.set(senderNumber, 0);
        await this.sendCatalogPage(whatsappPhone, senderNumber, sock, 0);
        return;
      }

      // 7. FALLBACK
      botResponseText = settings?.fallback_message || 'Lo siento, no entendí tu mensaje. Escribe *Catálogo* para ver productos o *Terminar* para cerrar la sesión.';
      await sock.sendMessage(senderNumber, { text: botResponseText });

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

  private async sendCatalogPage(whatsappPhone: string, senderNumber: string, sock: any, page: number) {
    const allProducts = await this.productRepository.find({
      where: { whatsapp_phone: whatsappPhone, status: true },
      order: { name: 'ASC' }
    });

    if (allProducts.length === 0) {
      await sock.sendMessage(senderNumber, { text: '❌ No hay productos disponibles en este momento.' });
      return;
    }

    const pageSize = 12;
    const totalPages = Math.ceil(allProducts.length / pageSize);
    const startIdx = page * pageSize;
    const pageProducts = allProducts.slice(startIdx, startIdx + pageSize);

    let catalogText = `📋 *Catálogo de Productos* (Pg. ${page + 1}/${totalPages})\n\nEscribe el *número* o *nombre* para ver detalles:\n`;

    pageProducts.forEach((prod, idx) => {
      const itemNumber = startIdx + idx + 1;
      catalogText += `\n*${itemNumber}.* ${prod.name} - *$${prod.price}*`;
    });

    catalogText += `\n\n👇 *Opciones:*\n• Escribe *Siguiente* para ver más.\n• Escribe *Terminar* para cerrar el chat.`;

    await sock.sendMessage(senderNumber, { text: catalogText });
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
        try { await sock.logout(); } catch (e) { }
        try { sock.end(undefined); } catch (e) { }
        this.sessions.delete(whatsappPhone);
      }

      this.initializing.delete(whatsappPhone);
      this.botStartTimes.delete(whatsappPhone);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const authFolder = path.resolve(process.cwd(), `baileys_auth/session-${whatsappPhone}`);
      if (fs.existsSync(authFolder)) {
        fs.rmSync(authFolder, { recursive: true, force: true });
      }

      return { success: true, message: 'Sesión cerrada y desvinculada correctamente' };
    } catch (error) {
      console.error('Error en disconnectWhatsApp:', error);
      return { success: false, message: 'Error al cerrar sesión' };
    }
  }

  async checkConnectionStatus(whatsappPhone: string) {
    const authFolder = path.resolve(process.cwd(), `baileys_auth/session-${whatsappPhone}`);
    const credsPath = path.resolve(authFolder, 'creds.json');

    const isConnectedInMemory = this.sessions.has(whatsappPhone);
    const isConnectedInDisk = fs.existsSync(credsPath);

    return {
      connected: isConnectedInMemory || isConnectedInDisk,
      message: (isConnectedInMemory || isConnectedInDisk) ? 'Conectado' : 'Desconectado'
    };
  }
}