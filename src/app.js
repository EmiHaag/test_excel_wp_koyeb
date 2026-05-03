const express = require('express');
const path = require('path');
const indexRoutes = require('./routes/index.routes');
const qrRoutes = require('./routes/qr.routes');

function createApp(state) {
    const app = express();

    // Configuración para túneles y proxies
    app.set('trust proxy', true);

    app.use(express.static('public'));
    app.use(express.json());

    // CORS básico
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        next();
    });

    // Rutas
    app.use('/', indexRoutes);
    app.use('/qr', qrRoutes(state));

    return app;
}

module.exports = createApp;
