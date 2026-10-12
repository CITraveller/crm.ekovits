FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-openpyxl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node deploy/migrate.js ./deploy/migrate.js
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4310
EXPOSE 4310
CMD ["node", "server/index.js"]
