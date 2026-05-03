const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');

module.exports = (state) => {
    /**
     * Página del QR protegida por autenticación.
     */
    router.get('/', authMiddleware, (req, res) => {
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
                        // Usamos la ruta absoluta desde la raíz para mayor compatibilidad
                        const response = await fetch('/qr/api', {
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

    /**
     * Endpoint API para obtener el código QR actual.
     */
    router.get('/api', authMiddleware, (req, res) => {
        res.json({
            qr: state.currentQR
        });
    });

    return router;
};
