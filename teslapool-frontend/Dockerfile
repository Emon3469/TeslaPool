# TeslaPool web (Next.js standalone output).
# BACKEND_URL is needed at BUILD time too: Next.js bakes rewrite destinations into the build.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc* ./
RUN sed -i '/^cache=/d' .npmrc 2>/dev/null || true; npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_URL=http://api:3000
ENV BACKEND_URL=$BACKEND_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG BACKEND_URL=http://api:3000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 BACKEND_URL=$BACKEND_URL
RUN addgroup -S web && adduser -S web -G web
COPY --from=build --chown=web:web /app/.next/standalone ./
COPY --from=build --chown=web:web /app/.next/static ./.next/static
COPY --from=build --chown=web:web /app/public ./public
USER web
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
