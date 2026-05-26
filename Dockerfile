# Stage 1 — Build admin frontend
FROM node:20-alpine AS admin-builder
WORKDIR /admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

# Stage 2 — Serveur de production
FROM node:20-alpine AS server
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY public/ ./public/
COPY --from=admin-builder /admin/dist ./admin/dist
EXPOSE 3000
CMD ["node", "src/index.js"]
