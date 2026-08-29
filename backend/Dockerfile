FROM node:20-alpine

WORKDIR /app

# PDFKit, OCR y procesamiento de imágenes consultan el catálogo de fuentes.
# Instalarlo evita advertencias de Fontconfig y mantiene una tipografía de
# respaldo estable dentro del contenedor.
RUN apk add --no-cache fontconfig ttf-dejavu

# Instalar dependencias primero (capa cacheada)
COPY package*.json ./
RUN npm ci --omit=dev

# Copiar código fuente
COPY --chown=node:node . .

RUN npm run check \
    && npm test \
    && npm audit --omit=dev --audit-level=high

RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

EXPOSE 5000

USER node

CMD ["node", "server.js"]
