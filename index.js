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
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const AutoResponseService = require('./autoResponse');

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = '11pp2Hna3pWmBK5t82m9ymIFPce-aD3HZmI00pgaLEDo';
const RANGE = 'tabla_clientes_wp!A2';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LID_MAP_PATH = path.join(__dirname, 'lid_map.json');
const AUTH_DIR = path.join(__dirname, 'auth_info'); // Adaptado para el volumen

const http = require('http');

global.latestQR = null; // Variable global para guardar el QR temporalmente en memoria

// --- HTTP Server for Health Check y Web QR ---
const PORT = process.env.PORT || 8000;

const server = http.createServer(async (req, res) => {
    // Normalizamos la URL usando el host de la petición
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = parsedUrl.pathname;


    // Removemos la barra diagonal al final si existe (ej: /health/ -> /health)
    if (pathname.endsWith('/') && pathname.length > 1) {
        pathname = pathname.slice(0, -1);
    }

    if (pathname === '/health') {
        res.writeHead(200, {
            'Content-Type': 'text/plain'
        });
        res.end('OK');
    } else if (pathname === '/qr') {
        if (typeof global.latestQR !== 'undefined' && global.latestQR) {
            try {
                const qrImage = await QRCode.toDataURL(global.latestQR);

                res.writeHead(200, {
                    'Content-Type': 'text/html'
                });
                res.end(`
                    <!DOCTYPE html>
                    <html lang="es">
                    <head>
                        <meta charset="UTF-8">
                        <title>Vincular WhatsApp</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                                background-color: #111827;
                                color: #ffffff;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                height: 100vh;
                                margin: 0;
                            }
                            .card {
                                background-color: #1f2937;
                                padding: 2.5rem;
                                border-radius: 0.75rem;
                                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
                                text-align: center;
                            }
                            img {
                                background: white;
                                padding: 1rem;
                                border-radius: 0.5rem;
                            }
                            h2 { margin-bottom: 0.5rem; color: #10b981; }
                            p { color: #9ca3af; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <h2>Escanea el código QR</h2>
                            <p>Usa la cámara de tu WhatsApp para vincular</p>
                            <br>
                            <img src="${qrImage}" alt="QR Code de WhatsApp" width="250" height="250">
                        </div>
                    </body>
                    </html>
                `);
            } catch (error) {
                res.writeHead(500, {
                    'Content-Type': 'text/plain'
                });
                res.end('Error interno al generar la imagen QR.');
            }
        } else {
            res.writeHead(404, {
                'Content-Type': 'text/html'
            });
            res.end(`
                <html lang="es">
                <body style="background:#111827;color:#fff;font-family:sans-serif;text-align:center;padding-top:20%;">
                    <h2>Aún no hay código QR disponible</h2>
                    <p>Espera unos segundos y refresca la página o reinicia el bot.</p>
                </body>
                </html>
            `);
        }
    } else {
        res.writeHead(404, {
            'Content-Type': 'text/plain'
        });
        res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Health check y Web QR server running on port ${PORT}`);
});

const autoResponseService = new AutoResponseService(SPREADSHEET_ID, CREDENTIALS_PATH);


async function createSocket() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Windows', 'Chrome', '120.0.0.0'],
        connectTimeoutMs: 90000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        logger: require('pino')({
            level: 'error'
        }),
        qrTimeout: 60000,
        retryRequestDelayMs: 250
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
}



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
        const credentialsJson = process.env.CREDENTIALS_JSON;
        if (!credentialsJson) {
            throw new Error("CREDENTIALS_JSON environment variable not set. Please provide Google Cloud credentials.");
        }
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
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
    console.log('🚀 Iniciando bot de WhatsApp...');
    console.log(`📋 SpreadsheetID: ${SPREADSHEET_ID}`);
    console.log(`📂 Credenciales: ${CREDENTIALS_PATH}`);

    try {
        // --- LIMPIEZA DE SESIÓN (Plan eMicro) ---
        // Eliminamos el directorio de sesión al arrancar para forzar una nueva vinculación
        if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, {
                recursive: true,
                force: true
            });
            console.log('🧹 Carpeta de sesión eliminada por inconsistencias en el handshake.');
        }

        // Aseguramos que el directorio esté creado y vacío
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, {
                recursive: true
            });
        }

        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(AUTH_DIR);
        const sock = await createSocket();
        console.log('✅ Socket de WhatsApp creado con configuración optimizada');

        let hasRequestedCode = false; // Bandera para pedir el código una sola vez

        sock.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect,
                qr
            } = update;

            // --- LÓGICA DEL CÓDIGO QR WEB ---
            if (qr) {
                global.latestQR = qr;
                console.log('📶 Nuevo código QR detectado y guardado en memoria.');
            }

            // --- LÓGICA AMPLIADA PARA EL PAIRING CODE ---
            if (!sock.authState.creds.registered && !hasRequestedCode) {
                hasRequestedCode = true;

                // Aumentamos la espera a 10 segundos para dar tiempo a que la red se estabilice
                console.log('⏳ Esperando 10 segundos para estabilizar la conexión antes de solicitar el código...');
                await new Promise(resolve => setTimeout(resolve, 10000));

                const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
                try {
                    console.log('Solicitando código de emparejamiento...');
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ${code}\n`);
                    console.log('Ve a WhatsApp > Dispositivos vinculados > Vincular con el número de teléfono e introduce este código.');
                } catch (error) {
                    console.error('Error al solicitar el código de emparejamiento:', error);
                    hasRequestedCode = false; // Si falla, permitimos reintentar
                }
            }

            if (connection === 'close') {
                // Obtenemos la razón de la desconexión
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('⚠️ Conexión cerrada. Motivo:', lastDisconnect.error);

                // Si no es un cierre de sesión definitivo, reconectamos el bot
                if (shouldReconnect) {
                    startSock(); // Llama a tu función principal de inicio aquí
                }
            } else if (connection === 'open') {
                console.log('🟢 ¡Conexión establecida exitosamente!');
                // Limpiamos el QR en memoria para que no sea accesible una vez vinculado
                global.latestQR = null;
            } else if (connection === 'connecting') {
                console.log('⏳ El bot está intentando conectar con WhatsApp...');
            }
        });

        sock.ev.on('creds.update', () => {
            console.log('💾 Credenciales actualizadas');
            saveCreds();
        });

        // --- INTERCEPTOR DE NODOS CRUDOS ---
        sock.ws.on('CB:message', (node) => {
            const from = node.attrs.from;
            if (from && from.endsWith('@lid')) {
                console.log(`DEBUG [CB:message] Atributos del nodo:`, JSON.stringify(node.attrs, null, 2));
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
            console.log(`📬 messages.upsert: tipo=${m.type}, cantidad=${m.messages.length}`);
            if (m.type !== 'notify') {
                console.log(`⏭️  Ignorando tipo: ${m.type}`);
                return;
            }

            for (const msg of m.messages) {
                try {
                    if (msg.key.fromMe) {
                        console.log('🤖 Mensaje propio, ignorando');
                        continue;
                    }

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
                    if (!messageText) {
                        console.log('⏭️  Mensaje sin texto, ignorando');
                        continue;
                    }

                    const sanitizedMsg = sanitizeText(messageText);
                    const dateStr = formatTimestamp(msg.messageTimestamp);
                    console.log(`📩 Mensaje de ${pushName} (${phone}): ${sanitizedMsg}`);

                    await syncToSheet({
                        dateStr,
                        pushName,
                        phone,
                        sanitizedMsg
                    });

                    try {
                        const match = await autoResponseService.findMatch(messageText);
                        if (match) {
                            console.log(`✅ Match encontrado, enviando respuesta...`);
                            await sock.sendPresenceUpdate('composing', jid);
                            setTimeout(async () => {
                                try {
                                    await sock.sendMessage(jid, {
                                        text: match.reply
                                    });
                                    console.log(`✉️  Respuesta enviada a ${phone}`);
                                    await sock.sendPresenceUpdate('paused', jid);
                                } catch (err) {
                                    console.error(`❌ Error enviando mensaje a ${phone}:`, err.message);
                                }
                            }, 5000);
                        } else {
                            console.log(`❌ No match para: ${sanitizedMsg}`);
                        }
                    } catch (err) {
                        console.error(`❌ Error en findMatch:`, err.message);
                    }
                } catch (err) {
                    console.error(`❌ Error procesando mensaje:`, err.message);
                }
            }
        });

    } catch (err) {
        console.error(`❌ Error crítico al iniciar:`, err.message);
        console.error(err.stack);
        setTimeout(() => startWhatsApp(), 5000);
    }
}

console.log('⏱️  ' + new Date().toLocaleString('es-AR'));
startWhatsApp().catch(err => {
    console.error("❌ Error crítico:", err.message);
    console.error(err.stack);
    setTimeout(() => startWhatsApp(), 5000);
});