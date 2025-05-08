# Use Node.js image with FFmpeg
FROM node:18-alpine

# Install FFmpeg and build tools
RUN apk add --no-cache \
    ffmpeg \
    build-base \
    python3 \
    git

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source files
COPY . .

# Set up persistent storage
RUN mkdir -p /usr/src/app/auth_info \
    && mkdir -p /usr/src/app/temp \
    && touch /usr/src/app/permissions.json \
    && chown -R node:node /usr/src/app

USER node

# Start command
CMD [ "npm", "start" ]