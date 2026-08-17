// ops/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'jarvis-web',
      cwd: __dirname + '/..',
      // Same reasoning as the OTT repo's own ecosystem.config.js: PM2 forks
      // this script directly rather than through a shell, so it must be the
      // real entry file, not the node_modules/.bin shim.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'jarvis-worker',
      cwd: __dirname + '/..',
      script: 'node_modules/.bin/tsx',
      args: 'worker/push-worker.ts',
      env: { NODE_ENV: 'production' },
    },
  ],
};
