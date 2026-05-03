require('dotenv').config();
const path = require('path');
const fs = require('fs');
const AutoResponseService = require('./services/autoResponse.service'); // Movido a services
const LidService = require('./services/lid.service');
const {
    startWhatsApp
} = require('./services/whatsapp.service');
const createApp = require('./app');

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = process.env.SHEET_ID;
const WEB_PORT = process.env.PORT || 3000;
const AUTH_FOLDER = 'auth_info_baileys';
const LID_MAP_PATH = path.join(__dirname, '..', 'lid_map.json');

// Validación de configuración crítica
if (!SPREADSHEET_ID) {
    console.error('❌ ERROR: La variable SHEET_ID no está definida en el archivo .env');
} else {
    console.log(`📊 Spreadsheet ID cargado: ${SPREADSHEET_ID.substring(0, 5)}...${SPREADSHEET_ID.substring(SPREADSHEET_ID.length - 5)}`);
}

// Estado compartido
const state = {
    currentQR: null
};

// Obtener credenciales de Google
function getGoogleCredentials() {
    let credsRaw = process.env.CREDENTIALS_JSON;
    
    if (credsRaw) {
        try {
            // Si la cadena viene envuelta en comillas por el archivo .env, las quitamos
            if (credsRaw.startsWith("'") && credsRaw.endsWith("'")) {
                credsRaw = credsRaw.slice(1, -1);
            } else if (credsRaw.startsWith('"') && credsRaw.endsWith('"')) {
                credsRaw = credsRaw.slice(1, -1);
            }
            
            return JSON.parse(credsRaw);
        } catch (e) {
            console.error('❌ Error parseando CREDENTIALS_JSON. Asegúrate de que sea un JSON válido en una sola línea.');
            console.error('Error detalle:', e.message);
            return null;
        }
    }
    const localPath = path.join(__dirname, '..', 'credentials.json');
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
    }
    return null;
}

// Limpiar carpeta de autenticación al iniciar (opcional, según lógica original)
function cleanAuthFolder() {
    if (fs.existsSync(AUTH_FOLDER)) {
        try {
            fs.rmSync(AUTH_FOLDER, {
                recursive: true,
                force: true
            });
            console.log('🧹 Carpeta de autenticación limpiada');
        } catch (e) {
            console.error('⚠️ Error limpiando carpeta de auth:', e.message);
        }
    }
}

// Inicialización
async function main() {
    // cleanAuthFolder(); // Descomentar si quieres limpiar sesión en cada reinicio

    const googleCredentials = getGoogleCredentials();
    const autoResponseService = new AutoResponseService(SPREADSHEET_ID, googleCredentials);
    const lidService = new LidService(LID_MAP_PATH);

    const config = {
        authFolder: AUTH_FOLDER,
        spreadsheetId: SPREADSHEET_ID,
        googleCredentials,
        autoResponseService,
        lidService
    };

    // Iniciar WhatsApp
    startWhatsApp(config, state).catch(err => console.error("Error crítico en WhatsApp:", err));

    // Iniciar Servidor Web
    const app = createApp(state);
    app.listen(WEB_PORT, '0.0.0.0', () => {
        console.log(`🌐 Servidor web modular disponible en puerto ${WEB_PORT}`);
        console.log(`🔒 Ruta QR protegida en /qr`);
    });
}

main().catch(err => console.error("Error en el arranque:", err));