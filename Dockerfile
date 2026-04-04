FROM node:22-alpine AS base
WORKDIR /app

# Dependências de build (bcrypt precisa de compilação nativa)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/

EXPOSE 3000

CMD ["node", "src/server.js"]
