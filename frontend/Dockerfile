# ── Etapa 1: Build de Vite ────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Una vulnerabilidad alta/crítica impide reemplazar la versión que ya está activa.
RUN npm run audit:security

RUN npm run lint && npm test

# VITE_API_URL=/api → nginx externo lo proxea al backend
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build && npm run test:performance

# ── Etapa 2: Servir archivos estáticos ────────────────────────────────────────
FROM nginx:stable-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
