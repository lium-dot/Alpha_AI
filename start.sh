#!/bin/sh

# Create required directories
mkdir -p auth_info temp

# Set permissions
chmod 700 auth_info
chmod 600 permissions.json

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
  npm install
fi

# Start the bot
node bot.js