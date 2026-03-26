FROM node:22-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files and install
COPY package.json ./
RUN npm install --production

# Copy server code
COPY src/ ./src/

# Create temp directory for transcoding jobs
RUN mkdir -p /tmp/transcode

EXPOSE 8080

CMD ["node", "src/server.js"]
