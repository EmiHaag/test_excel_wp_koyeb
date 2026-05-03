/**
 * Middleware para autenticación básica HTTP con tiempo de sesión.
 */
module.exports = (req, res, next) => {
    const QR_USER = process.env.QR_USER;
    const QR_PASS = process.env.QR_PASS;

    if (!QR_USER || !QR_PASS) {
        console.warn('⚠️ QR_USER o QR_PASS no configurados.');
        return res.status(500).send('Configuración de seguridad incompleta.');
    }

    // Generamos un "Reino" que cambia cada 2 minutos (120000ms)
    // Esto fuerza al navegador a pedir la contraseña de nuevo cuando el periodo cambia.
    const sessionWindow = Math.floor(Date.now() / 120000); 
    const realm = `QR Access ${sessionWindow}`;

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.set('WWW-Authenticate', `Basic realm="${realm}"`);
        return res.status(401).send('Autenticación requerida.');
    }

    const b64auth = authHeader.split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login === QR_USER && password === QR_PASS) {
        return next();
    }

    // Si fallan las credenciales, volvemos a pedir
    res.set('WWW-Authenticate', `Basic realm="${realm}"`);
    return res.status(401).send('Credenciales incorrectas.');
};
