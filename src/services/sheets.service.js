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

        const rangeRead = 'tabla_clientes_wp!A1:D';
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
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
                spreadsheetId,
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
                spreadsheetId,
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

module.exports = { syncToSheet };
