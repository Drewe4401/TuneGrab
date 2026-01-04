# TuneGrab - YouTube to MP3 Converter
# Docker Image based on Node.js with yt-dlp and ffmpeg

FROM node:20-alpine

# Install dependencies for yt-dlp and ffmpeg
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    && pip3 install --break-system-packages yt-dlp

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY public ./public

# Create downloads directory
RUN mkdir -p downloads

# Expose port (default 3000, can be overridden)
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/ || exit 1

# Run as non-root user for security
RUN addgroup -g 1001 -S tunegrab && \
    adduser -S tunegrab -u 1001 -G tunegrab -h /home/tunegrab && \
    mkdir -p /home/tunegrab && \
    chown -R tunegrab:tunegrab /home/tunegrab && \
    chown -R tunegrab:tunegrab /app

USER tunegrab

# Start the application
CMD ["node", "server.js"]
