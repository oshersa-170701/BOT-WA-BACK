import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
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

      const senderNumberFull = msg.key.remoteJid || '';
      const cleanSenderPhone = senderNumberFull.replace(/@s\.whatsapp\.net|@c\.us|@g\.us/g, '').trim();
      const phoneVariants = [senderNumberFull, cleanSenderPhone, `${cleanSenderPhone}@s.whatsapp.net`, `${cleanSenderPhone}@c.us`];

      const messageContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.ephemeralMessage?.message?.conversation ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text || '';

      const incomingText = messageContent.trim();
      if (!incomingText) return;

      let botResponseText = '';
      const normalizeStr = (str: string) =>
        str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() : "";

      const cleanIncomingText = normalizeStr(incomingText);

      // =========================================================================
      // 1. MÁQUINA DE ESTADOS INTERACTIVA DE LEAD / ASESOR (PRIORIDAD ABSOLUTA)
      // =========================================================================
      let lead = await this.leadRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone }
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
        lead.pending_company_name = incomingText;
        lead.conversation_state = 'confirming_company';
        await this.leadRepository.save(lead);

        botResponseText = `¿Es correcto el nombre de tu empresa: *${incomingText}*? Responde *Sí* para confirmar o *No* para corregirlo:`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      if (lead && lead.conversation_state === 'confirming_company') {
        if (cleanIncomingText === 'si' || cleanIncomingText === 'sí' || cleanIncomingText === 'correcto') {
          lead.company_name = lead.pending_company_name;
          lead.pending_company_name = '';
          lead.conversation_state = 'assigned_to_human';
          await this.leadRepository.save(lead);

          botResponseText = `✅ ¡Información registrada con éxito!\n\n🤝 En unos momentos un asesor se comunicará contigo. ¡Gracias!`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else {
          lead.conversation_state = 'collecting_company';
          lead.pending_company_name = '';
          await this.leadRepository.save(lead);

          botResponseText = `Entendido. Por favor escribe nuevamente el nombre correcto de tu compañía o empresa:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }
      }

      // =========================================================================
      // 2. MÁQUINA DE ESTADOS INTERACTIVA DE COTIZACIÓN
      // =========================================================================
      let pendingQuoteName = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Esperando Nombre' }
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
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Esperando Teléfono' }
      });

      if (pendingQuotePhone) {
        pendingQuotePhone.client_phone = incomingText;
        pendingQuotePhone.status = 'Esperando Producto';
        pendingQuotePhone.products_requested = '';
        await this.quoteRepository.save(pendingQuotePhone);

        botResponseText = `¡Perfecto! Escribe el *nombre o descripción del producto* que deseas buscar.\n\n*(💡 Consejo: Si deseas ver la lista de productos, escribe "Catálogo")*`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      let quoteWaitingProduct = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Esperando Producto' }
      });

      if (quoteWaitingProduct) {
        if (cleanIncomingText === 'catalogo' || cleanIncomingText === 'catálogo' || cleanIncomingText === 'ver todos') {
          this.catalogPages.set(cleanSenderPhone, 0);
          await this.sendCatalogPage(whatsappPhone, senderNumberFull, cleanSenderPhone, sock, 0);
          // 💡 Aseguramos que conserve el estado de cotización al consultar el catálogo
          botResponseText = `\n\n*(Escribe el nombre del producto que deseas agregar a tu cotización)*`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }

        const searchResults = await this.productRepository.find({
          where: [
            { whatsapp_phone: whatsappPhone, status: true, name: Like(`%${incomingText}%`) },
            { whatsapp_phone: whatsappPhone, status: true, category: Like(`%${incomingText}%`) }
          ],
          take: 5
        });

        if (searchResults.length === 0) {
          botResponseText = `❌ No encontramos productos similares con "${incomingText}". Intenta escribir otro nombre o escribe *Catálogo* para ver la lista:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }

        quoteWaitingProduct.search_results_cache = searchResults;
        quoteWaitingProduct.status = 'Seleccionando Producto';
        await this.quoteRepository.save(quoteWaitingProduct);

        let listText = `🔍 Encontramos estos productos para *"${incomingText}"*:\n\n`;
        searchResults.forEach((p, idx) => {
          listText += `*${idx + 1}.* ${p.name} - $${p.price}\n`;
        });
        listText += `\n👉 Escribe el *número* del producto que deseas:`;

        await sock.sendMessage(senderNumberFull, { text: listText });
        return;
      }

      let quoteSelectingProduct = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Seleccionando Producto' }
      });

      if (quoteSelectingProduct) {
        const selectionIndex = parseInt(incomingText, 10) - 1;
        const cache = quoteSelectingProduct.search_results_cache || [];

        if (isNaN(selectionIndex) || selectionIndex < 0 || selectionIndex >= cache.length) {
          botResponseText = `⚠️ Selección inválida. Por favor escribe un número válido de la lista anterior:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }

        const selectedProd = cache[selectionIndex];
        quoteSelectingProduct.pending_product_id = selectedProd.id;
        quoteSelectingProduct.pending_product_name = selectedProd.name;
        quoteSelectingProduct.status = 'Confirmando Producto';
        await this.quoteRepository.save(quoteSelectingProduct);

        botResponseText = `Has seleccionado: *${selectedProd.name}* ($${selectedProd.price}).\n\n¿Es correcto este producto? Responde *Sí* o *No*:`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      let quoteConfirmingProduct = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Confirmando Producto' }
      });

      if (quoteConfirmingProduct) {
        if (cleanIncomingText === 'si' || cleanIncomingText === 'sí' || cleanIncomingText === 'correcto') {
          quoteConfirmingProduct.status = 'Esperando Cantidad';
          await this.quoteRepository.save(quoteConfirmingProduct);

          botResponseText = `¡Excelente! ¿Qué *cantidad* de *${quoteConfirmingProduct.pending_product_name}* deseas agregar? (Escribe solo el número, ej. *5*):`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else {
          quoteConfirmingProduct.status = 'Esperando Producto';
          quoteConfirmingProduct.pending_product_id = 0;
          quoteConfirmingProduct.pending_product_name = '';
          await this.quoteRepository.save(quoteConfirmingProduct);

          botResponseText = `Entendido. Escribe nuevamente el nombre del producto que buscas:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }
      }

      let quoteWaitingQty = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Esperando Cantidad' }
      });

      if (quoteWaitingQty) {
        const qty = parseInt(incomingText, 10);
        if (isNaN(qty) || qty <= 0) {
          botResponseText = `⚠️ Cantidad inválida. Por favor escribe un número mayor a 0:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }

        quoteWaitingQty.pending_quantity = qty;
        quoteWaitingQty.status = 'Confirmando Cantidad';
        await this.quoteRepository.save(quoteWaitingQty);

        botResponseText = `Vas a agregar: *${qty} pieza(s)* de *${quoteWaitingQty.pending_product_name}*.\n\n¿Confirmas esta cantidad? Responde *Sí* o *No*:`;
        await sock.sendMessage(senderNumberFull, { text: botResponseText });
        return;
      }

      let quoteConfirmingQty = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Confirmando Cantidad' }
      });

      if (quoteConfirmingQty) {
        if (cleanIncomingText === 'si' || cleanIncomingText === 'sí' || cleanIncomingText === 'correcto') {
          const newItem = `${quoteConfirmingQty.pending_quantity}x ${quoteConfirmingQty.pending_product_name}`;
          const currentReq = quoteConfirmingQty.products_requested ? quoteConfirmingQty.products_requested + '\n• ' : '• ';
          quoteConfirmingQty.products_requested = currentReq + newItem;

          quoteConfirmingQty.pending_product_id = 0;
          quoteConfirmingQty.pending_product_name = '';
          quoteConfirmingQty.pending_quantity = 0;
          quoteConfirmingQty.status = 'Preguntar Otro Producto';
          await this.quoteRepository.save(quoteConfirmingQty);

          botResponseText = `✅ ¡Producto agregado con éxito!\n\n¿Deseas agregar *otro producto* o *finalizar* tu cotización? (Escribe *Agregar* o *Finalizar*):`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else {
          quoteConfirmingQty.status = 'Esperando Cantidad';
          quoteConfirmingQty.pending_quantity = 0;
          await this.quoteRepository.save(quoteConfirmingQty);

          botResponseText = `Entendido. Escribe nuevamente la cantidad que deseas:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }
      }

      let quoteAskAnother = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Preguntar Otro Producto' }
      });

      if (quoteAskAnother) {
        if (cleanIncomingText.includes('agregar') || cleanIncomingText.includes('otro') || cleanIncomingText.includes('si')) {
          quoteAskAnother.status = 'Esperando Producto';
          await this.quoteRepository.save(quoteAskAnother);

          botResponseText = `Perfecto. Escribe el nombre del *siguiente producto* que deseas buscar:\n\n*(💡 O escribe "Catálogo" si deseas consultar la lista)*`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else if (cleanIncomingText.includes('finalizar') || cleanIncomingText.includes('terminar') || cleanIncomingText.includes('listo')) {
          quoteAskAnother.status = 'Confirmando Finalizar';
          await this.quoteRepository.save(quoteAskAnother);

          botResponseText = `📋 *Resumen de tu cotización:*\n${quoteAskAnother.products_requested}\n\n¿Confirmas que deseas enviar y finalizar tu cotización? Responde *Sí* para confirmar:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else {
          botResponseText = `⚠️ No entendí tu respuesta. Por favor escribe *Agregar* para otro producto o *Finalizar* para concluir:`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }
      }

      let quoteConfirmFinal = await this.quoteRepository.findOne({
        where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone, status: 'Confirmando Finalizar' }
      });

      if (quoteConfirmFinal) {
        if (cleanIncomingText === 'si' || cleanIncomingText === 'sí' || cleanIncomingText === 'correcto' || cleanIncomingText === 'finalizar') {
          quoteConfirmFinal.status = 'Pendiente';
          await this.quoteRepository.save(quoteConfirmFinal);

          botResponseText = `✅ ¡Cotización guardada y finalizada con éxito!\n\n📋 *Resumen final:*\n${quoteConfirmFinal.products_requested}\n\nUn asesor revisará tu solicitud y se pondrá en contacto contigo en breve. ¡Muchas gracias!`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        } else {
          quoteConfirmFinal.status = 'Preguntar Otro Producto';
          await this.quoteRepository.save(quoteConfirmFinal);

          botResponseText = `Continuamos con tu cotización. ¿Deseas agregar *otro producto* o *finalizar*?`;
          await sock.sendMessage(senderNumberFull, { text: botResponseText });
          return;
        }
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
      // 4. BIENVENIDA O SALUDO INICIAL
      // =========================================================================
      const previousChatsCount = await this.chatLogRepository.count({
        where: [
          { phone_number: senderNumberFull, whatsapp_phone: whatsappPhone },
          { phone_number: cleanSenderPhone, whatsapp_phone: whatsappPhone }
        ]
      });

      const isWelcomeMessage = previousChatsCount === 0 || cleanIncomingText === 'hola';

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
          where: { client_phone: In(phoneVariants), whatsapp_phone: whatsappPhone }
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
      // 7. CATÁLOGOS Y BÚSQUEDA DE PRODUCTOS
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

      if (cleanIncomingText === 'ver todos' || cleanIncomingText === 'catalogo' || cleanIncomingText === 'catálogo' || (cleanIncomingText.length === 1 && /^[a-z]$/.test(cleanIncomingText))) {
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
      console.error('Error in disconnectWhatsApp:', error);
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