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
const qrcodeLib = require('qrcode');
const express = require('express');
const path = require('path');
const fs = require('fs');
const AutoResponseService = require('./autoResponse');

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = '11pp2Hna3pWmBK5t82m9ymIFPce-aD3HZmI00pgaLEDo';
const RANGE = 'tabla_clientes_wp!A2';
const WEB_PORT = process.env.PORT || 3000;
const AUTH_FOLDER = 'auth_info_baileys';
const CREDENTIALS_FILE = 'auth_creds.json';
const LID_MAP_PATH = path.join(__dirname, 'lid_map.json');

// Obtener credenciales de Google desde variable de entorno o archivo local
function getGoogleCredentials() {
    if (process.env.CREDENTIALS_JSON) {
        try {
            return JSON.parse(process.env.CREDENTIALS_JSON);
        } catch (e) {
            console.error('❌ Error parseando CREDENTIALS_JSON');
            return null;
        }
    }
    // Fallback para desarrollo local
    const localPath = path.join(__dirname, 'credentials.json');
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    }
    return null;
}

// Limpiar carpeta de autenticación al iniciar
function cleanAuthFolder() {
    if (fs.existsSync(AUTH_FOLDER)) {
        try {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            console.log('🧹 Carpeta de autenticación limpiada');
        } catch (e) {
            console.error('⚠️ Error limpiando carpeta de auth:', e.message);
        }
    }
}

cleanAuthFolder();

const autoResponseService = new AutoResponseService(SPREADSHEET_ID, getGoogleCredentials());

// --- SERVIDOR WEB PARA QR ---
let currentQR = null;
const app = express();

app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp QR Scanner</title>
        <style>
            body { font-family: Arial; text-align: center; padding: 40px; background: #f5f5f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #25d366; margin-bottom: 20px; }
            #qr { margin: 20px 0; min-height: 350px; display: flex; align-items: center; justify-content: center; flex-direction: column; }
            #status { margin-top: 20px; font-size: 14px; color: #666; }
            #debug { margin-top: 20px; font-size: 12px; color: #999; max-height: 100px; overflow-y: auto; text-align: left; background: #f9f9f9; padding: 10px; border-radius: 4px; }
            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #25d366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            canvas { max-width: 100%; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>WhatsApp Bot</h1>
            <div id="qr">
                <div class="spinner"></div>
                <p>Escaneando...</p>
            </div>
            <div id="status">Esperando código QR...</div>
            <div id="debug">Debug: iniciando...</div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
            let qrContainer = document.getElementById('qr');
            let status = document.getElementById('status');
            let debug = document.getElementById('debug');
            let lastQR = null;
            let attemptCount = 0;

            function addDebug(msg) {
                debug.innerHTML = msg + '<br>' + debug.innerHTML;
                if (debug.innerHTML.split('<br>').length > 5) {
                    debug.innerHTML = debug.innerHTML.split('<br>').slice(0, 5).join('<br>');
                }
            }

            async function fetchQR() {
                attemptCount++;
                try {
                    const response = await fetch('/api/qr', {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(\`HTTP error! status: \${response.status}\`);
                    }

                    const data = await response.json();

                    addDebug(\`Intento \${attemptCount}: QR = \${data.qr ? 'SÍ' : 'NO'}\`);

                    if (data.qr && data.qr !== lastQR) {
                        lastQR = data.qr;
                        qrContainer.innerHTML = '';
                        addDebug('Generando QR...');

                        try {
                            new QRCode(qrContainer, {
                                text: data.qr,
                                width: 300,
                                height: 300,
                                colorDark: '#000000',
                                colorLight: '#ffffff',
                                correctLevel: QRCode.CorrectLevel.H
                            });
                            status.innerHTML = '📱 Escanea el código QR con tu WhatsApp';
                            addDebug('QR generado exitosamente');
                        } catch (qrErr) {
                            addDebug('Error generando QR: ' + qrErr.message);
                        }
                    } else if (!data.qr && lastQR) {
                        status.innerHTML = '✅ Sesión iniciada correctamente';
                        addDebug('Sesión activa');
                    }
                } catch (error) {
                    addDebug('Error fetch: ' + error.message);
                    status.innerHTML = '❌ Error conectando';
                }
            }

            addDebug('Página cargada');
            fetchQR();
            setInterval(fetchQR, 1000);
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/api/qr', (req, res) => {
    res.json({ qr: currentQR });
});

// --- HEALTH CHECK PARA KOYEB ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const server = app.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web disponible en puerto ${WEB_PORT}`);
    console.log(`💚 Health check disponible en /${WEB_PORT}/health`);
});

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
        const credentials = getGoogleCredentials();
        if (!credentials) {
            console.error('❌ No hay credenciales de Google configuradas');
            return;
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
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
    } = await useMultiFileAuthState(AUTH_FOLDER);
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
        if (qr) {
            currentQR = qr;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ?
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            currentQR = null;
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