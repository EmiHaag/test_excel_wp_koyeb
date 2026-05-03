const { Client, LocalAuth } = require('whatsapp-web.js');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
const AutoResponseService = require('./autoResponse');

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = '11pp2Hna3pWmBK5t82m9ymIFPce-aD3HZmI00pgaLEDo';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LID_MAP_PATH = path.join(__dirname, 'lid_map.json');
const AUTH_DIR = path.join(__dirname, 'auth_info');

global.latestQR = null;
const PORT = process.env.PORT || 8000;

// --- HTTP Server for Health Check y Web QR ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let pathname = parsedUrl.pathname;

    if (pathname.endsWith('/') && pathname.length > 1) {
        pathname = pathname.slice(0, -1);
    }

    if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    } else if (pathname === '/qr') {
        if (typeof global.latestQR !== 'undefined' && global.latestQR) {
            try {
                const qrImage = await QRCode.toDataURL(global.latestQR);
                res.writeHead(200, { 'Content-Type': 'text/html' });
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
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error interno al generar la imagen QR.');
            }
        } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
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
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Health check y Web QR server running on port ${PORT}`);
});

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
    return text.replace(/[^\x20-\x7E -ÿĀ-ſƀ-ɏḀ-ỿ]/g, '').trim();
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
async function syncToSheet({ dateStr, pushName, phone, sanitizedMsg }) {
    try {
        let credentialsJson = process.env.CREDENTIALS_JSON;
        if (!credentialsJson && fs.existsSync(CREDENTIALS_PATH)) {
            credentialsJson = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
        }
        if (!credentialsJson) {
            throw new Error("CREDENTIALS_JSON not found. Set env var or create credentials.json");
        }
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

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
                    values: [[dateStr, pushName, phone, newMsg]]
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
                    values: [[dateStr, pushName, phone, sanitizedMsg]]
                },
            });
            console.log(`✅ Nuevo cliente en fila ${targetRow}.`);
        }
    } catch (error) {
        console.error('❌ Error Sheets:', error);
    }
}

// --- WHATSAPP CLIENT ---
const getPuppeteerConfig = () => {
    const isWindows = process.platform === 'win32';
    const executablePath = isWindows
        ? process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        : process.env.BROWSER_PATH || '/usr/bin/chromium';

    return {
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
};

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: getPuppeteerConfig()
});

client.on('qr', (qr) => {
    global.latestQR = qr;
    console.log('📶 Nuevo QR detectado y guardado en memoria.');
});

client.on('ready', () => {
    console.log('🟢 ¡Cliente de WhatsApp conectado!');
    global.latestQR = null;
});

client.on('message', async (msg) => {
    try {
        if (msg.fromMe) {
            console.log('🤖 Mensaje propio, ignorando');
            return;
        }

        const contact = await msg.getContact();
        const phone = contact.number;
        const pushName = contact.name || contact.pushname || 'Desconocido';
        const sanitizedMsg = sanitizeText(msg.body);
        const dateStr = formatTimestamp(Math.floor(Date.now() / 1000));

        console.log(`📩 Mensaje de ${pushName} (${phone}): ${sanitizedMsg}`);

        await syncToSheet({ dateStr, pushName, phone, sanitizedMsg });

        try {
            const match = await autoResponseService.findMatch(msg.body);
            if (match) {
                console.log(`✅ Match encontrado, enviando respuesta...`);
                setTimeout(async () => {
                    try {
                        await msg.reply(match.reply);
                        console.log(`✉️  Respuesta enviada a ${phone}`);
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
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente desconectado:', reason);
});

client.initialize().catch(err => {
    console.error('❌ Error crítico:', err.message);
    setTimeout(() => process.exit(1), 5000);
});

console.log('⏱️  ' + new Date().toLocaleString('es-AR'));
