module.exports = {
  apps: [
    {
      name: 'ingestion',
      script: 'dist/index.js',
      interpreter: 'node',
      cwd: `${process.env.APP_HOME}/mssd-ingestion`,
      env: {
        NODE_ENV: 'production',
        SWARM_RPC_URL: process.env.SWARM_RPC_URL,
        GSOC_RESOURCE_ID: process.env.GSOC_RESOURCE_ID,
        GSOC_TOPIC: process.env.GSOC_TOPIC,
        STREAM_KEY: process.env.STREAM_KEY,
        STAMP: process.env.STAMP,
        RTMP_SECRET: process.env.RTMP_SECRET,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '32G',
      time: true,
    },
  ],
};
