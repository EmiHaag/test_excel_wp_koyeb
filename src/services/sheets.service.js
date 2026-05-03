const { google } = require('googleapis');

async function syncToSheet({ spreadsheetId, credentials, dateStr, pushName, phone, sanitizedMsg }) {
    try {
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

        const sheetName = process.env.NOMBRE_SHEET_REGISTROS_WP || 'tabla_clientes_wp';
        const rangeRead = `${sheetName}!A1:Z`;
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: rangeRead,
        });

        const rows = response.data.values || [];
        if (rows.length === 0) {
            console.warn(`⚠️ La hoja ${sheetName} está vacía.`);
        }

        const headers = rows[0] ? rows[0].map(h => String(h).toLowerCase().trim()) : [];
        
        // Configuración de columnas por nombre desde env
        const colFechaName = (process.env.NOMBRE_COL_1_REGISTROS_WP || 'fecha').toLowerCase();
        const colNombreName = (process.env.NOMBRE_COL_2_REGISTROS_WP || 'nombre').toLowerCase();
        const colTelefonoName = (process.env.NOMBRE_COL_3_REGISTROS_WP || 'telefono').toLowerCase();
        const colMensajesName = (process.env.NOMBRE_COL_4_REGISTROS_WP || 'mensaje').toLowerCase();

        // Encontrar índices o usar defaults (0, 1, 2, 3)
        const idxFecha = headers.indexOf(colFechaName) !== -1 ? headers.indexOf(colFechaName) : 0;
        const idxNombre = headers.indexOf(colNombreName) !== -1 ? headers.indexOf(colNombreName) : 1;
        const idxTelefono = headers.indexOf(colTelefonoName) !== -1 ? headers.indexOf(colTelefonoName) : 2;
        const idxMensajes = headers.indexOf(colMensajesName) !== -1 ? headers.indexOf(colMensajesName) : 3;

        let rowIndex = -1;
        let firstEmptyRow = -1;

        for (let i = 1; i < rows.length; i++) { // Empezar en 1 para saltar headers
            const row = rows[i];
            const isRowEmpty = !row || row.every(cell => !String(cell).trim());
            if (isRowEmpty && firstEmptyRow === -1) firstEmptyRow = i + 1;

            if (!isRowEmpty) {
                const cellValue = String(row[idxTelefono] || '').trim();
                if (cellValue === String(phone).trim()) {
                    rowIndex = i;
                    break;
                }
            }
        }

        const maxIdx = Math.max(idxFecha, idxNombre, idxTelefono, idxMensajes);
        const colLetter = String.fromCharCode(65 + maxIdx); // E.g., 3 -> 'D'

        if (rowIndex !== -1) {
            const realRow = rowIndex + 1;
            const existingMsg = rows[rowIndex][idxMensajes] || '';
            const newMsg = `${existingMsg}\n[${dateStr}] ${sanitizedMsg}`;

            const updateValues = new Array(maxIdx + 1).fill('');
            updateValues[idxFecha] = dateStr;
            updateValues[idxNombre] = pushName;
            updateValues[idxTelefono] = phone;
            updateValues[idxMensajes] = newMsg;

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A${realRow}:${colLetter}${realRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [updateValues]
                },
            });
            console.log(`📝 Fila ${realRow} actualizada en ${sheetName}.`);
        } else {
            const targetRow = firstEmptyRow !== -1 ? firstEmptyRow : rows.length + 1;
            
            const insertValues = new Array(maxIdx + 1).fill('');
            insertValues[idxFecha] = dateStr;
            insertValues[idxNombre] = pushName;
            insertValues[idxTelefono] = phone;
            insertValues[idxMensajes] = sanitizedMsg;

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A${targetRow}:${colLetter}${targetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [insertValues]
                },
            });
            console.log(`✅ Nuevo cliente en fila ${targetRow} de ${sheetName}.`);
        }
    } catch (error) {
        console.error('❌ Error Sheets:', error);
    }
}

module.exports = { syncToSheet };
