/**
 * Limpia el texto de caracteres no deseados para evitar errores en Google Sheets.
 */
function sanitizeText(text) {
    if (!text) return '';
    return text.replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF]/g, '').trim();
}

module.exports = sanitizeText;
