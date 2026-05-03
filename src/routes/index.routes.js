const express = require('express');
const router = express.Router();

/**
 * Ruta raíz: Ya no muestra el QR.
 */
router.get('/', (req, res) => {
    res.send(`
        <h1>WhatsApp Bot Server</h1>
        <p>El servidor está funcionando correctamente.</p>
        <p>Para vincular tu cuenta, ve a <a href="/qr">/qr</a></p>
    `);
});

/**
 * Health check para monitoreo y despliegues (Koyeb, Docker, etc.)
 */
router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

module.exports = router;
