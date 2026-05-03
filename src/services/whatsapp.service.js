const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const {
    Boom
} = require('@hapi/boom');
const pino = require('pino');
const sanitizeText = require('../utils/sanitize');
const formatTimestamp = require('../utils/formatTimestamp');
const {
    syncToSheet
} = require('./sheets.service');

async function startWhatsApp(config, state, services) {
    const {
        authFolder,
        spreadsheetId,
        googleCredentials,
        autoResponseService,
        lidService
    } = config;

    const {
        state: authState,
        saveCreds
    } = await useMultiFileAuthState(authFolder);
    const {
        version
    } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: authState,
        printQRInTerminal: false,
        browser: ['Windows', 'Chrome', '110.0.5481.178'],
        logger: pino({
            level: 'silent'
        })
    });

    sock.ev.on('connection.update', (update) => {
        const {
            connection,
            lastDisconnect,
            qr
        } = update;

        if (qr) {
            state.currentQR = qr;
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ?
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;

            if (shouldReconnect) {
                console.log('🔄 Reconectando WhatsApp...');
                startWhatsApp(config, state, services);
            }
        } else if (connection === 'open') {
            state.currentQR = null;
            console.log('🚀 Conexión WhatsApp Exitosa');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Interceptor de nodos LID
    sock.ws.on('CB:message', (node) => {
        const from = node.attrs.from;
        if (from && from.endsWith('@lid')) {
            const potentialPn = node.attrs.actual_pn || node.attrs.sender_pn || node.attrs.phash || node.attrs.pn;
            if (potentialPn) {
                const jidPn = potentialPn.includes('@') ? potentialPn : `${potentialPn}@s.whatsapp.net`;
                if (!lidService.get(from)) {
                    console.log(`🔍 [LID Mapping] ¡Mapeo ENCONTRADO!: ${from} -> ${jidPn}`);
                    lidService.set(from, jidPn);
                }
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const participant = msg.key.participant;
            let senderJid = participant || jid;

            // Resolución LID -> PN
            if (senderJid.endsWith('@lid')) {
                const cachedJid = lidService.get(senderJid);
                if (cachedJid) {
                    senderJid = cachedJid;
                } else {
                    try {
                        const results = await sock.onWhatsApp(senderJid);
                        if (Array.isArray(results) && results.length > 0 && results[0].jid) {
                            const fullJid = results[0].jid;
                            if (fullJid.endsWith('@s.whatsapp.net')) {
                                lidService.set(senderJid, fullJid);
                                senderJid = fullJid;
                            }
                        }
                    } catch (err) {
                        console.error('❌ [onWhatsApp] Error:', err.message);
                    }
                }
            }

            const phone = senderJid.split('@')[0];
            const pushName = msg.pushName || 'Desconocido';
            let messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (!messageText) continue;

            const sanitizedMsg = sanitizeText(messageText);
            const dateStr = formatTimestamp(msg.messageTimestamp);

            console.log(`📩 Mensaje de ${pushName} (${phone}): ${sanitizedMsg}`);

            await syncToSheet({
                spreadsheetId,
                credentials: googleCredentials,
                dateStr,
                pushName,
                phone,
                sanitizedMsg
            });

            const match = await autoResponseService.findMatch(messageText);
            if (match) {
                await sock.sendPresenceUpdate('composing', jid);
                setTimeout(async () => {
                    await sock.sendMessage(jid, {
                        text: match.reply
                    });
                    await sock.sendPresenceUpdate('paused', jid);
                }, 5000);
            }
        }
    });

    return sock;
}

module.exports = {
    startWhatsApp
};