FROM node:20-alpine

WORKDIR /usr/src/app

# Copiar los archivos de dependencias
COPY package*.json ./

# Instalar las dependencias de producción
RUN npm ci --only=production

# Copiar el resto del código
COPY . .

# Comando de inicio (ajusta según tu archivo principal, ej: index.js o app.js)
CMD [ "node", "index.js" ]