# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Build
RUN npm run build || true

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy built files
COPY --from=builder /app/dist ./dist

# Create data directories
RUN mkdir -p /data/repos /data/workspaces /data/sessions /data/logs /data/skills

# Set ownership
RUN chown -R nodejs:nodejs /app /data

USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e 'require("http").get("http://localhost:3001/health", (r) => process.exit(r.statusCode === 200 ? 0 : 1))'

# Start command
CMD ["node", "dist/index.js"]
