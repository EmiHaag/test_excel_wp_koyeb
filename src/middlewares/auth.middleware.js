/**
 * Middleware para autenticación básica HTTP.
 * Utiliza las variables de entorno QR_USER y QR_PASS.
 */
module.exports = (req, res, next) => {
    const QR_USER = process.env.QR_USER;
    const QR_PASS = process.env.QR_PASS;

    // Si no están configuradas las credenciales, bloqueamos por seguridad
    // o podrías optar por dejar pasar si estás en desarrollo.
    if (!QR_USER || !QR_PASS) {
        console.warn('⚠️ QR_USER o QR_PASS no configurados. Acceso denegado por defecto.');
        return res.status(500).send('Configuración de seguridad incompleta.');
    }

    const auth = { login: QR_USER, password: QR_PASS };
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === auth.login && password === auth.password) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="QR Access"');
    res.status(401).send('Autenticación requerida.');
};
