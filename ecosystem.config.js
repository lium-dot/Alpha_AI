module.exports = {
  apps: [{
    name: "ALPHA-BOT",
    script: "./bot.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "500M",
    env: {
      NODE_ENV: "production",
      BOT_NUMBER: process.env.BOT_NUMBER,
      ADMIN_JID: process.env.ADMIN_JID,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      LOG_LEVEL: "info"
    },
    log_date_format: "YYYY-MM-DD HH:mm Z",
    error_file: "./logs/alpha-error.log",
    out_file: "./logs/alpha-out.log",
    pid_file: "./logs/alpha.pid",
    node_args: "--experimental-modules",
    instance_var: "INSTANCE_ID"
  }]
};