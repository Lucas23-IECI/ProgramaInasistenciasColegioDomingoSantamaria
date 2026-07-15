FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (capa cacheada)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
