# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Alpine build tools needed for any native addons (mysql2, etc.)
RUN apk add --no-cache python3 make g++

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Use npm install (NOT npm ci) with legacy peer deps
# npm ci requires lockfileVersion mismatch handling that breaks in some envs
RUN npm install --legacy-peer-deps

# Copy all source code
COPY . .

# Build frontend (Vite) + backend (esbuild/tsc)
RUN npm run build

# ─── Stage 2: Production Runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Set production mode so Express serves static files and skips Vite dev server
ENV NODE_ENV=production

# Copy node_modules from builder (already compiled, avoids re-compilation issues)
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Copy package.json for runtime metadata (optional but good practice)
COPY package.json ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Railway dynamically assigns $PORT — expose the default
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
