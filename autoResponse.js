const { google } = require('googleapis');
const path = require('path');

class AutoResponseService {
    constructor(spreadsheetId, credentialsPath) {
        this.spreadsheetId = spreadsheetId;
        this.credentialsPath = credentialsPath;
        this.responsesCache = null;
        this.lastFetch = 0;
        this.cacheDuration = 60000; // 1 minuto de cache
    }

    async getResponses() {
        const now = Date.now();
        if (this.responsesCache && (now - this.lastFetch < this.cacheDuration)) {
            console.log(`📖 [AutoResponse] Cache válido, ${this.responsesCache.length} respuestas en caché`);
            return this.responsesCache;
        }

        try {
            console.log(`📡 [AutoResponse] Leyendo respuestas de Google Sheets...`);
                    const credentialsJson = process.env.CREDENTIALS_JSON;
        if (!credentialsJson) {
            throw new Error("CREDENTIALS_JSON environment variable not set. Please provide Google Cloud credentials.");
        }
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(credentialsJson),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

            const sheets = google.sheets({ version: 'v4', auth });
            console.log(`🔍 [AutoResponse] Consultando rango respuestas_bot!A1:Z`);
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'respuestas_bot!A1:Z',
            });

            const rows = response.data.values;
            console.log(`📊 [AutoResponse] Filas obtenidas: ${rows ? rows.length : 0}`);
            if (!rows || rows.length < 2) {
                console.warn(`⚠️  [AutoResponse] Sin datos en la hoja o menos de 2 filas`);
                this.responsesCache = [];
            } else {
                const headers = rows[0].map(h => h.toLowerCase().trim());
                const keywordIdx = headers.indexOf('palabra_clave');
                const responseIdx = headers.indexOf('respuesta');

                if (keywordIdx === -1 || responseIdx === -1) {
                    console.error('❌ No se encontraron las columnas "palabra_clave" o "respuesta" en la hoja "respuestas_bot"');
                    console.log('Encabezados encontrados:', headers);
                    this.responsesCache = [];
                } else {
                    this.responsesCache = rows.slice(1).map(row => {
                        const rawKeywords = row[keywordIdx] || '';
                        // Dividir por comas, slashes o múltiples espacios, y limpiar
                        const keywords = rawKeywords
                            .split(/[,/\s]+/) // Regex para uno o más de: , / o espacio
                            .map(k => k.toLowerCase().trim())
                            .filter(k => k.length > 1); // Ignorar letras sueltas o vacíos
                        
                        return {
                            keywords,
                            reply: row[responseIdx]
                        };
                    }).filter(item => item.keywords.length > 0 && item.reply);

                    console.log(`✅ ${this.responsesCache.length} respuestas automáticas cargadas.`);
                    if (this.responsesCache.length > 0) {
                        const allKeys = this.responsesCache.flatMap(r => r.keywords);
                        console.log('Palabras clave registradas:', allKeys.join(', '));
                    }
                }
            }

            this.lastFetch = now;
            return this.responsesCache;
        } catch (error) {
            console.error('❌ [AutoResponse] Error al obtener respuestas:', error.message);
            console.error('Stack:', error.stack);
            return this.responsesCache || [];
        }
    }

    async findMatch(messageText) {
        const responses = await this.getResponses();
        const text = messageText.toLowerCase();

        console.log(`🔎 [AutoResponse] Buscando match en ${responses.length} respuestas. Texto: "${text}"`);

        const match = responses.find(item =>
            item.keywords.some(keyword => {
                const found = text.includes(keyword);
                if (found) console.log(`   ✅ Match encontrado: "${keyword}"`);
                return found;
            })
        );

        if (match) {
            console.log(`✨ [AutoResponse] Respuesta encontrada: "${match.reply.substring(0, 50)}..."`);
        } else {
            console.log(`🔇 [AutoResponse] Sin respuesta automática para este mensaje`);
        }

        return match;
    }
}

module.exports = AutoResponseService;
