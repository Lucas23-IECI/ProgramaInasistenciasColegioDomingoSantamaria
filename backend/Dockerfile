FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (capa cacheada)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY --chown=node:node . .

RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

EXPOSE 5000

USER node

CMD ["node", "server.js"]
