# Railway builds this repo as the AIS collector (see collector/). The web app is deployed
# separately on Vercel, so this image intentionally runs ONLY the collector — no frontend
# build, no Caddy. Railway auto-detects this Dockerfile and uses it instead of Nixpacks/Railpack.
FROM node:20-slim
WORKDIR /app
# install only the collector's runtime deps (ws + @neondatabase/serverless)
COPY collector/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY collector/index.mjs collector/aircraft.mjs ./
# DATABASE_URL and AISSTREAM_API_KEY are injected by Railway at runtime.
CMD ["node", "index.mjs"]
