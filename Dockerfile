FROM node:26.7.0-bookworm-slim

ENV NODE_ENV=production \
	KUCEDR_CLOUD_DATA_DIR=/data \
	NODE_OPTIONS=--enable-source-maps
WORKDIR /app

RUN npm install --global npm@12.0.2

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
	&& npm cache clean --force

COPY src/main ./src/main
COPY src/ui ./src/ui

RUN mkdir -p /data/workspace && chown -R node:node /app /data

USER node
EXPOSE 3000 3001
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3000/.well-known/agent-card.json').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/main/index.ts"]
