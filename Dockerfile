FROM node:20-alpine

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first (for layer caching)
COPY package.json package-lock.json* .npmrc* ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm install --legacy-peer-deps

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Verify build output exists and show structure
RUN ls -la dist/ && ls -la dist/public/

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

# Set working directory to /app so process.cwd() = /app
# dist/public is at /app/dist/public ✅
WORKDIR /app

# Set production mode only — DO NOT hardcode PORT.
# Railway injects $PORT automatically; hardcoding causes port mismatch → 502.
ENV NODE_ENV=production

# EXPOSE uses Railway's injected PORT (Railway replaces this at runtime)
EXPOSE ${PORT:-3000}

# Start the app — Railway overrides this with startCommand from railway.toml
CMD ["node", "/app/dist/index.js"]
