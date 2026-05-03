const {
    google
} = require('googleapis');
const path = require('path');
const fs = require('fs');

class AutoResponseService {
    constructor(spreadsheetId, credentials) {
        this.spreadsheetId = spreadsheetId;
        this.credentials = credentials;
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

            if (!this.credentials) {
                throw new Error("Credentials not configured. Set GOOGLE_CREDENTIALS environment variable or ensure credentials.json exists");
            }

            const auth = new google.auth.GoogleAuth({
                credentials: this.credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            });

            const sheets = google.sheets({
                version: 'v4',
                auth
            });
            const sheetName = process.env.NOMBRE_SHEET_RESPUESTAS_BOT || 'respuestas_bot';
            console.log(`🔍 [AutoResponse] Consultando rango ${sheetName}!A1:Z`);
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: `${sheetName}!A1:Z`,
            });

            const rows = response.data.values;
            console.log(`📊 [AutoResponse] Filas obtenidas: ${rows ? rows.length : 0}`);
            if (!rows || rows.length < 2) {
                console.warn(`⚠️  [AutoResponse] Sin datos en la hoja o menos de 2 filas`);
                this.responsesCache = [];
            } else {
                const headers = rows[0].map(h => h.toLowerCase().trim());
                const col1Name = (process.env.NOMBRE_COL_1_RESPUESTAS_BOT || 'palabras clave').toLowerCase();
                const col2Name = (process.env.NOMBRE_COL_2_RESPUESTAS_BOT || 'respuesta').toLowerCase();
                const col3Name = (process.env.NOMBRE_COL_3_RESPUESTAS_BOT || 'sector').toLowerCase();

                const keywordIdx = headers.indexOf(col1Name);
                const responseIdx = headers.indexOf(col2Name);
                const extraIdx = headers.indexOf(col3Name);

                if (keywordIdx === -1 || responseIdx === -1) {
                    console.error(`❌ No se encontraron las columnas "${col1Name}" o "${col2Name}" en la hoja`);
                    console.log('Encabezados encontrados:', headers);
                    this.responsesCache = [];
                } else {
                    this.responsesCache = rows.slice(1).map(row => {
                        const rawKeywords = row[keywordIdx] || '';
                        const keywords = rawKeywords
                            .split(/[,/\s]+/)
                            .map(k => k.toLowerCase().trim())
                            .filter(k => k.length > 1);

                        const extraInfo = extraIdx !== -1 ? (row[extraIdx] || '').trim() : '';

                        return {
                            keywords,
                            reply: row[responseIdx],
                            extraInfo
                        };
                    }).filter(item => item.keywords.length > 0 && item.reply);

                    console.log(`✅ ${this.responsesCache.length} respuestas automáticas cargadas.`);
                }
            }

            this.lastFetch = now;
            return this.responsesCache;
        } catch (error) {
            console.error('❌ [AutoResponse] Error al obtener respuestas:', error.message);
            return this.responsesCache || [];
        }
    }

    async findMatch(messageText) {
        const responses = await this.getResponses();
        
        // Limpiamos y separamos el mensaje del usuario en palabras individuales
        const messageWords = messageText.toLowerCase()
            .split(/[^a-z0-9áéíóúñ]+/) // Separar por cualquier cosa que no sea letra o número
            .filter(w => w.length > 1);

        console.log(`🔎 [AutoResponse] Analizando palabras del mensaje: ${messageWords.join(', ')}`);

        // Evaluamos cada respuesta de la tabla
        const matches = responses.map(item => {
            // Contamos cuántas palabras del mensaje coinciden exactamente con los keywords de esta fila
            const matchedWords = messageWords.filter(word => 
                item.keywords.some(kw => word === kw)
            );
            
            // Eliminamos duplicados de palabras que hayan coincidido
            const uniqueMatches = [...new Set(matchedWords)];
            
            return { 
                ...item, 
                matchCount: uniqueMatches.length,
                // Densidad: qué tan bien cubre este tag el total de keywords de la fila
                score: uniqueMatches.length / item.keywords.length 
            };
        }).filter(item => item.matchCount > 0);

        if (matches.length === 0) {
            console.log(`🔇 [AutoResponse] Sin respuesta automática para este mensaje`);
            return null;
        }

        // Ordenamos por relevancia (matchCount) y luego especificidad (score)
        matches.sort((a, b) => {
            if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
            return b.score - a.score;
        });
        
        const bestMatch = matches[0];
        
        // Agregar la columna 3 (extraInfo) entre paréntesis si existe
        let finalReply = bestMatch.reply;
        if (bestMatch.extraInfo) {
            finalReply = `${finalReply} (${bestMatch.extraInfo})`;
        }

        console.log(`   ✅ Match encontrado (${bestMatch.matchCount} aciertos): "${bestMatch.keywords.join(', ')}"`);
        console.log(`✨ [AutoResponse] Respuesta final: "${finalReply.substring(0, 50)}..."`);

        return { ...bestMatch, reply: finalReply };
    }
}

module.exports = AutoResponseService;