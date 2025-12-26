module.exports = {
  apps: [{
    name: 'streaming-api',
    script: './src/server.js',
    instances: 2, // 2 instancias para balanceo
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G', // Reiniciar si usa > 1GB RAM
    min_uptime: '10s',
    max_restarts: 5,
    autorestart: true,
    watch: false,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};

