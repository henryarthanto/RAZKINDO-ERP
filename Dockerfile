# ============================================
# Razkindo ERP - Production Dockerfile (STB)
# Supports: ARM64 (Raspberry Pi) + AMD64 (x86)
# ============================================

# --- Stage 1: Dependencies (bun) ---
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# --- Stage 2: Build (node for QEMU compatibility) ---
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./
COPY --from=deps /app/bun.lock* ./
COPY . .

RUN npx prisma generate

ENV STB_MODE=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx next build

# --- Stage 3: Production (bun runtime) ---
FROM oven/bun:1-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV STB_MODE=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN apk add --no-cache libc6-compat openssl

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy standalone output
COPY --from=builder --chown=appuser:nodejs /app/.next/standalone ./

# Copy static assets
COPY --from=builder --chown=appuser:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:nodejs /app/public ./public

# Copy node_modules for serverExternalPackages
# IMPORTANT: Must copy from builder (Stage 2), NOT deps (Stage 1)
# because prisma generate runs in Stage 2 and outputs to node_modules/.prisma/client
# Without this, the PrismaClient import fails at runtime → 500 Internal Server Error
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

RUN mkdir -p /app/db /app/logs && chown -R appuser:nodejs /app

USER appuser
EXPOSE 3000 81

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["bun", "server.js"]
