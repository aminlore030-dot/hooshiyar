# ─── هوش‌یار — Dockerfile (self-host) ───
# Build:  docker build -t hooshiyar .
# Run:    docker run -p 3000:3000 -v hooshiyar_workspace:/app/workspace hooshiyar

FROM oven/bun:1 AS base
WORKDIR /app

# ─── deps ───
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ─── build ───
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
# پرisma/SQLite روی stale data حساس نیست؛ اپ از IndexedDB استفاده می‌کند و Prisma اختیاری است
RUN bun run build || (echo "build failed" && exit 1)

# ─── runtime ───
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOOSHIYAR_WORKSPACE=/app/workspace

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
# MCP mini-service (اختیاری)
COPY --from=builder /app/mini-services ./mini-services

RUN mkdir -p /app/workspace
VOLUME /app/workspace
EXPOSE 3000

# فرآیند اصلی: Next.js standalone (یا fallback به next start)
CMD ["sh", "-c", "if [ -f .next/standalone/server.js ]; then node .next/standalone/server.js; else bunx next start -p 3000; fi"]
