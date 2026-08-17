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
      // Same reasoning as jarvis-web above: PM2 forks this script directly
      // (not through a shell), so it must be the real tsx entry file, not
      // the node_modules/.bin shim, which is a shell script and breaks
      // under direct exec.
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'worker/push-worker.ts',
      // tsx does NOT read .env files itself (verified empirically — unlike
      // `next start`, which loads them via Next's own @next/env). In
      // practice this hasn't mattered: worker/push-worker.ts imports
      // ../src/lib/prisma, and instantiating PrismaClient loads the whole
      // .env into process.env as a side effect (it resolves schemaEnvPath
      // at runtime) before any worker code runs — so every var .env
      // defines has always been visible here, not just DATABASE_URL. This
      // flag is defense-in-depth for that implicit dependency: Node's own
      // --env-file populates process.env directly, independent of Prisma's
      // side effect, so the worker's environment is guaranteed rather than
      // incidental. Note this also makes a missing .env fail loudly at
      // startup (ENOENT) instead of silently relying on Prisma having
      // loaded it — deliberate: .env is a documented prerequisite for this
      // box.
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
    },
  ],
};
