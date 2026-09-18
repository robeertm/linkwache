# Linkwache, selbst gehostet (NAS/Server). Läuft als unprivilegierter Nutzer, nur Node 22.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY public ./public
COPY server ./server
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
ENV PORT=8080 DATA_DIR=/data
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
