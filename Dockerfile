FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV BROWSER_PATH=/usr/bin/chromium
ENV NODE_ENV=production

EXPOSE 8000

CMD ["npm", "start"]
