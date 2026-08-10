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

      const senderNumberFull = msg.key.remoteJid || '';
      const cleanSenderPhone = senderNumberFull.replace(/@s\.whatsapp\.net|@c\.us|@g\.us/g, '').trim();
      
      const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      const incomingText = messageContent.trim();
      if (!incomingText) return;

      let botResponseText = '';
      const normalizeStr = (str: string) =>
        str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";

      const cleanIncomingText = normalizeStr(incomingText);

      // =========================================================================
      // 1. FLUJO DE COTIZACIÓN ACTIVO (BARRERA ABSOLUTA E INQUEBRANTABLE)
      // =========================================================================
      
      let pendingQuoteName = await this.quoteRepository.findOne({
        where: [
          { client_phone: senderNumberFull, whatsapp_phone: whatsappPhone, status: 'Esperando Nombre' },
          { client_phone: cleanSenderPhone, whatsapp_phone: whatsappPhone, status: 'Esperando Nombre' }
        ]
      });

      if (pendingQuoteName) {
        pendingQuoteName.client_name = incomingText;
        pendingQuoteName.status = 'Esperando Teléfono';
        await this.quoteRepository.save(pendingQuoteName);

        botResponseText = `¡Gracias, ${incomingText}! Ahora, por favor indícanos tu *número telefónico de contacto*:`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      let pendingQuotePhone = await this.quoteRepository.findOne({
        where: [
          { client_phone: senderNumberFull, whatsapp_phone: whatsappPhone, status: 'Esperando Teléfono' },
          { client_phone: cleanSenderPhone, whatsapp_phone: whatsappPhone, status: 'Esperando Teléfono' }
        ]
      });

      if (pendingQuotePhone) {
        pendingQuotePhone.client_phone = incomingText;
        pendingQuotePhone.status = 'Esperando Productos';
        pendingQuotePhone.products_requested = '';
        await this.quoteRepository.save(pendingQuotePhone);

        botResponseText = `¡Perfecto! Por favor indícanos el *producto y la cantidad* que deseas agregar a tu cotización (ej. *10 piezas de armella* o usa el número de nuestro *Catálogo*).\n\nCuando termines de agregar tus productos, escribe *Finalizar* para guardar tu cotización.`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      let activeQuoteProducts = await this.quoteRepository.findOne({
        where: [
          { client_phone: senderNumberFull, whatsapp_phone: whatsappPhone, status: 'Esperando Productos' },
          { client_phone: cleanSenderPhone, whatsapp_phone: whatsappPhone, status: 'Esperando Productos' }
        ]
      });

      if (activeQuoteProducts) {
        if (cleanIncomingText === 'finalizar' || cleanIncomingText === 'terminar' || cleanIncomingText === 'listo') {
          if (!activeQuoteProducts.products_requested || activeQuoteProducts.products_requested.trim() === '') {
            botResponseText = `⚠️ Aún no has agregado ningún producto. Escribe qué producto necesitas o escribe *Cancelar*.`;
            await sock.sendMessage(senderNumberFull, { text: botResponseText });
            return;
          }

          activeQuoteProducts.status = 'Pendiente';
          await this.quoteRepository.save(activeQuoteProducts);

          botResponseText = `✅ ¡Cotización guardada y finalizada con éxito!\n\n📋 *Resumen de tu solicitud:*\n${activeQuoteProducts.products_requested}\n\nUn asesor revisará tu solicitud y te enviará el presupuesto oficial en breve. ¡Muchas gracias!`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }

        const currentProducts = activeQuoteProducts.products_requested ? activeQuoteProducts.products_requested + '\n• ' : '• ';
        activeQuoteProducts.products_requested = currentProducts + incomingText;
        await this.quoteRepository.save(activeQuoteProducts);

        botResponseText = `🛒 Producto agregado correctamente a tu cotización.\n\n¿Deseas agregar **otro producto**? Escribe el siguiente producto o escribe **Finalizar** para concluir.`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      // =========================================================================
      // 2. FLUJO DE LEAD / ASESOR ACTIVO (BARRERA ABSOLUTA E INQUEBRANTABLE)
      // =========================================================================
      let lead = await this.leadRepository.findOne({
        where: [
          { client_phone: senderNumberFull, whatsapp_phone: whatsappPhone },
          { client_phone: cleanSenderPhone, whatsapp_phone: whatsappPhone }
        ]
      });

      if (lead && lead.conversation_state === 'assigned_to_human') {
        const reactivationTriggers = ['hola', 'catálogo', 'catalogo', 'bot', 'menu', 'menú'];
        if (reactivationTriggers.some(t => cleanIncomingText.includes(t))) {
          lead.conversation_state = 'active';
          await this.leadRepository.save(lead);
        } else {
          return;
        }
      }

      if (lead && lead.conversation_state === 'collecting_name') {
        lead.client_name = incomingText;
        lead.conversation_state = 'collecting_phone';
        await this.leadRepository.save(lead);

        botResponseText = `¡Mucho gusto, ${incomingText}! Ahora, por favor indícanos un *número telefónico de contacto*:`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      if (lead && lead.conversation_state === 'collecting_phone') {
        lead.client_phone = incomingText;
        lead.conversation_state = 'collecting_company';
        await this.leadRepository.save(lead);

        botResponseText = `¿A qué compañía, negocio o empresa pertenece?`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      if (lead && lead.conversation_state === 'collecting_company') {
        lead.company_name = incomingText;
        lead.conversation_state = 'assigned_to_human';
        await this.leadRepository.save(lead);

        botResponseText = `✅ ¡Información registrada con éxito!\n\n🤝 En unos momentos un asesor se comunicará contigo. ¡Gracias!`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      // =========================================================================
      // 3. COMANDOS GENERALES Y SALIDA MANUAL
      // =========================================================================
      const endSessionTriggers = ['salir', 'terminar', 'adios', 'adiós', 'finalizar', 'gracias'];
      if (endSessionTriggers.some(trigger => cleanIncomingText === trigger)) {
        botResponseText = `👋 Sesión finalizada. Gracias por comunicarte con nosotros. Si necesitas algo más, solo escribe *Hola* o *Catálogo*.`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });

        if (!lead) {
          lead = this.leadRepository.create({
            client_phone: cleanSenderPhone,
            whatsapp_phone: whatsappPhone,
            conversation_state: 'assigned_to_human'
          });
        } else {
          lead.conversation_state = 'assigned_to_human';
        }
        await this.leadRepository.save(lead);
        return;
      }

      // =========================================================================
      // 4. BIENVENIDA O SALUDO INICIAL (FLEXIBLE PARA CUALQUIER MENSAJE PREDETERMINADO)
      // =========================================================================
      const previousChatsCount = await this.chatLogRepository.count({
        where: [
          { phone_number: senderNumberFull, whatsapp_phone: whatsappPhone },
          { phone_number: cleanSenderPhone, whatsapp_phone: whatsappPhone }
        ]
      });

      const welcomeTriggers = ['hola', 'informacion', 'catalogo', 'buenos', 'buenas', 'cotizacion', 'asesor', 'ayuda'];
      const isWelcomeMessage = previousChatsCount === 0 || welcomeTriggers.some(t => cleanIncomingText.includes(t));

      if (isWelcomeMessage) {
        botResponseText = settings?.welcome_message || '¡Hola! Bienvenido a nuestro servicio automático.\n\nPuedes escribir *Catálogo*, *Cotización* o *Asesor*.';
        await sock.sendMessage(senderNumberFull, { text: botResponseText });

        if (lead) {
          lead.conversation_state = 'active';
          await this.leadRepository.save(lead);
        }

        await this.chatLogRepository.save({
          phone_number: cleanSenderPhone,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return;
      }

      // =========================================================================
      // 5. DETECCIÓN AUTOMÁTICA DE ASESOR / ASOCIADO
      // =========================================================================
      const advisorTriggers = ['asesor', 'proveedor', 'asociado', 'humano', 'representante'];
      if (advisorTriggers.some(trigger => cleanIncomingText.includes(trigger))) {
        let existingLead = await this.leadRepository.findOne({
          where: [
            { client_phone: senderNumberFull, whatsapp_phone: whatsappPhone },
            { client_phone: cleanSenderPhone, whatsapp_phone: whatsappPhone }
          ]
        });

        if (!existingLead) {
          existingLead = this.leadRepository.create({
            client_phone: cleanSenderPhone,
            whatsapp_phone: whatsappPhone,
            conversation_state: 'collecting_name'
          });
        } else {
          existingLead.conversation_state = 'collecting_name';
        }
        await this.leadRepository.save(existingLead);

        botResponseText = `🤝 Con mucho gusto te comunicaremos con un asociado o asesor humano. Para empezar, por favor indícanos: *¿Cuál es tu nombre?*`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      // =========================================================================
      // 6. PALABRAS CLAVE CONFIGURADAS
      // =========================================================================
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
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
        } else if (matchedRule.response_type === 'quote') {
          botResponseText = `¡Con mucho gusto te ayudamos con tu cotización! 📝\n\nPara empezar, por favor dinos: *¿Cuál es tu nombre?*`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });

          await this.quoteRepository.save({
            whatsapp_phone: whatsappPhone,
            client_phone: cleanSenderPhone,
            client_name: '',
            products_requested: '',
            total_estimated: 0.00,
            status: 'Esperando Nombre'
          });
        } else if (matchedRule.response_type === 'product_search') {
          this.catalogPages.set(cleanSenderPhone, 0);
          await this.sendCatalogPage(whatsappPhone, senderNumberFull, cleanSenderPhone, sock, 0);
          return;
        }

        await this.chatLogRepository.save({
          phone_number: cleanSenderPhone,
          incoming_message: incomingText,
          bot_response: botResponseText,
          whatsapp_phone: whatsappPhone,
        });
        return;
      }

      // =========================================================================
      // 7. CATÁLOGOS Y BÚSQUEDA SECUNDARIA DE PRODUCTOS (CON MAPEO GLOBAL DE ÍNDICES)
      // =========================================================================
      const allProducts = await this.productRepository.find({
        where: { whatsapp_phone: whatsappPhone, status: true },
        order: { name: 'ASC' }
      });

      if (cleanIncomingText === 'siguiente' || cleanIncomingText === 'mas' || cleanIncomingText === 'más') {
        let currentPage = this.catalogPages.get(cleanSenderPhone) || 0;
        currentPage++;

        const maxPages = Math.ceil(allProducts.length / 12);
        if (currentPage >= maxPages) {
          currentPage = 0;
        }

        this.catalogPages.set(cleanSenderPhone, currentPage);
        await this.sendCatalogPage(whatsappPhone, senderNumberFull, cleanSenderPhone, sock, currentPage);
        return;
      }

      let matchedProduct: Product | undefined = undefined;

      if (/^\d+$/.test(cleanIncomingText)) {
        const index = parseInt(cleanIncomingText, 10) - 1;
        if (index >= 0 && index < allProducts.length) {
          matchedProduct = allProducts[index];
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
          await sock.sendMessage(senderNumberFull, {
            image: { url: matchedProduct.image_url },
            caption: details + `\n\n*(Escribe "Siguiente" para ver más o "Terminar" para cerrar chat)*`
          });
        } else {
          await sock.sendMessage(senderNumberFull, { text: details + `\n\n*(Escribe "Siguiente" para ver más o "Terminar" para cerrar chat)*` });
        }
        return;
      }

      const matchedByCategoryOrPartial = allProducts.filter(p =>
        (p.category && normalizeStr(p.category).includes(cleanIncomingText)) ||
        (p.name && normalizeStr(p.name).includes(cleanIncomingText))
      );

      if (matchedByCategoryOrPartial.length > 0 && cleanIncomingText.length > 2) {
        let categoryResultsText = `🔍 *Encontramos ${matchedByCategoryOrPartial.length} productos:* \n\nEscribe el número o nombre exacto:\n`;

        matchedByCategoryOrPartial.slice(0, 12).forEach((prod, idx) => {
          categoryResultsText += `\n${idx + 1}. ${prod.name} ($${prod.price})`;
        });

        await sock.sendMessage(senderNumberFull, { text: categoryResultsText });
        return;
      }

      if (cleanIncomingText === 'ver todos' || (cleanIncomingText.length === 1 && /^[a-z]$/.test(cleanIncomingText))) {
        this.catalogPages.set(cleanSenderPhone, 0);
        await this.sendCatalogPage(whatsappPhone, senderNumberFull, cleanSenderPhone, sock, 0);
        return;
      }

      // =========================================================================
      // 8. FALLBACK GENERAL
      // =========================================================================
      botResponseText = settings?.fallback_message || 'Lo siento, no entendí tu mensaje. Escribe *Catálogo* para ver productos o *Terminar* para cerrar la sesión.';
      await sock.sendMessage(senderNumberFull, { text: botResponseText });

      await this.chatLogRepository.save({
        phone_number: cleanSenderPhone,
        incoming_message: incomingText,
        bot_response: botResponseText,
        whatsapp_phone: whatsappPhone,
      });

    } catch (error) {
      console.error('Error procesando mensaje con Baileys:', error);
    }
  }

  private async sendCatalogPage(whatsappPhone: string, senderNumberFull: string, cleanSenderPhone: string, sock: any, page: number) {
    const allProducts = await this.productRepository.find({
      where: { whatsapp_phone: whatsappPhone, status: true },
      order: { name: 'ASC' }
    });

    if (allProducts.length === 0) {
      await sock.sendMessage(senderNumberFull, { text: '❌ No hay productos disponibles en este momento.' });
      return;
    }

    const pageSize = 12;
    const totalPages = Math.ceil(allProducts.length / pageSize);
    const startIdx = page * pageSize;
    const pageProducts = allProducts.slice(startIdx, startIdx + pageSize);

    let catalogText = `📋 *Catálogo de Productos* (Pg. ${page + 1}/${totalPages})\n\nEscribe el *número global* o *nombre* para ver detalles:\n`;

    pageProducts.forEach((prod, idx) => {
      const itemNumber = startIdx + idx + 1;
      catalogText += `\n*${itemNumber}.* ${prod.name} - *$${prod.price}*`;
    });

    catalogText += `\n\n👇 *Opciones:*\n• Escribe *Siguiente* para ver más.\n• Escribe *Terminar* para cerrar el chat.`;

    await sock.sendMessage(senderNumberFull, { text: catalogText });
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