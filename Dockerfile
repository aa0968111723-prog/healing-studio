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

# Verify build output exists
RUN ls -la dist/index.js dist/public/

# Expose port
EXPOSE 3000

# Start the app
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
