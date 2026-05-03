const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const {
    Boom
} = require('@hapi/boom');
const {
    google
} = require('googleapis');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const AutoResponseService = require('./autoResponse');

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = '11pp2Hna3pWmBK5t82m9ymIFPce-aD3HZmI00pgaLEDo';
const RANGE = 'tabla_clientes_wp!A2';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LID_MAP_PATH = path.join(__dirname, 'lid_map.json');

const autoResponseService = new AutoResponseService(SPREADSHEET_ID, CREDENTIALS_PATH);

// --- PERSISTENCIA LID ---
function loadLidMap() {
    if (fs.existsSync(LID_MAP_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(LID_MAP_PATH, 'utf-8'));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveLidMap(map) {
    fs.writeFileSync(LID_MAP_PATH, JSON.stringify(map, null, 2));
}

let lidMap = loadLidMap();

// --- UTILIDADES ---
function sanitizeText(text) {
    if (!text) return '';
    return text.replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]/g, '').trim();
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

// --- GOOGLE SHEETS ---
async function syncToSheet({
    dateStr,
    pushName,
    phone,
    sanitizedMsg
}) {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({
            version: 'v4',
            auth
        });

        const rangeRead = 'tabla_clientes_wp!A1:D';
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: rangeRead,
        });

        const rows = response.data.values || [];
        let rowIndex = -1;
        let firstEmptyRow = -1;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const isRowEmpty = !row || row.every(cell => !String(cell).trim());
            if (isRowEmpty && firstEmptyRow === -1 && i > 0) firstEmptyRow = i + 1;

            if (!isRowEmpty) {
                const cellValue = String(row[2] || '').trim();
                if (cellValue === String(phone).trim()) {
                    rowIndex = i;
                    break;
                }
            }
        }

        if (rowIndex !== -1) {
            const realRow = rowIndex + 1;
            const existingMsg = rows[rowIndex][3] || '';
            const newMsg = `${existingMsg}\n[${dateStr}] ${sanitizedMsg}`;

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `tabla_clientes_wp!A${realRow}:D${realRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [
                        [dateStr, pushName, phone, newMsg]
                    ]
                },
            });
            console.log(`📝 Fila ${realRow} actualizada.`);
        } else {
            const targetRow = firstEmptyRow !== -1 ? firstEmptyRow : rows.length + 1;
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `tabla_clientes_wp!A${targetRow}:D${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [
                        [dateStr, pushName, phone, sanitizedMsg]
                    ]
                },
            });
            console.log(`✅ Nuevo cliente en fila ${targetRow}.`);
        }
    } catch (error) {
        console.error('❌ Error Sheets:', error);
    }
}

// --- WHATSAPP ---
async function startWhatsApp() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState('auth_info_baileys');
    const {
        version
    } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Windows', 'Chrome', '110.0.5481.178'],
        logger: require('pino')({
            level: 'silent'
        })
    });

    sock.ev.on('connection.update', (update) => {
        const {
            connection,
            lastDisconnect,
            qr
        } = update;
        if (qr) qrcode.generate(qr, {
            small: true
        });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ?
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 Conexión Exitosa');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- INTERCEPTOR DE NODOS CRUDOS (Estrategia GitHub) ---
    sock.ws.on('CB:message', (node) => {
        const from = node.attrs.from;
        if (from && from.endsWith('@lid')) {
            console.log(`DEBUG [CB:message] Atributos del nodo:`, JSON.stringify(node.attrs, null, 2));

            // Intentar buscar el PN en todos los atributos posibles
            const potentialPn = node.attrs.actual_pn || node.attrs.sender_pn || node.attrs.phash || node.attrs.pn;

            if (potentialPn) {
                const jidPn = potentialPn.includes('@') ? potentialPn : `${potentialPn}@s.whatsapp.net`;
                if (!lidMap[from]) {
                    console.log(`🔍 [CB:message] ¡Mapeo ENCONTRADO!: ${from} -> ${jidPn}`);
                    lidMap[from] = jidPn;
                    saveLidMap(lidMap);
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

            // RESOLUCIÓN LID -> PN
            if (senderJid.endsWith('@lid')) {
                console.log(`🔍 [LID Detectado] Intentando resolver: ${senderJid}`);

                if (lidMap[senderJid]) {
                    console.log(`📖 [LID Map] Usando caché: ${lidMap[senderJid]}`);
                    senderJid = lidMap[senderJid];
                } else {
                    try {
                        console.log(`📡 [onWhatsApp] Consultando a servidores para: ${senderJid}...`);
                        const results = await sock.onWhatsApp(senderJid);
                        console.log(`📡 [onWhatsApp] Respuesta bruta:`, JSON.stringify(results, null, 2));

                        if (results && results.length > 0) {
                            const result = results[0];
                            if (result.exists && result.jid.endsWith('@s.whatsapp.net')) {
                                console.log(`✅ [onWhatsApp] Resolución ÉXITO: ${senderJid} -> ${result.jid}`);
                                lidMap[senderJid] = result.jid;
                                saveLidMap(lidMap);
                                senderJid = result.jid;
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
}

startWhatsApp().catch(err => console.error("Error crítico:", err));