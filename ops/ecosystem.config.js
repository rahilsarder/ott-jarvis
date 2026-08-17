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
      // tsx does NOT read .env files (verified empirically — unlike `next
      // start`, which loads them via Next's own @next/env). Prisma Client
      // does load .env on its own (it resolves schemaEnvPath at runtime),
      // which is the only reason the worker's DB access works today — but
      // that covers DATABASE_URL alone. Nothing else in this process would
      // see .env, so any env var read via process.env here (today only
      // NODE_ENV; OTT_REPO_PATH / JARVIS_SESSION_SECRET if worker code ever
      // grows into the shared lib/) would silently be undefined. Node's own
      // --env-file flag populates process.env before tsx or push-worker.ts
      // is loaded, independently of tsx, so the worker's environment matches
      // jarvis-web's. Note this also makes a missing .env fail loudly at
      // startup (ENOENT) instead of half-working — deliberate: .env is a
      // documented prerequisite for this box.
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
    },
  ],
};
