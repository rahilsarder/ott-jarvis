#!/usr/bin/env bash
#
# One-command deploy for Jarvis itself — the control plane, not one of the
# branded deployments it manages. Far simpler than the OTT platform's own
# ops/deploy.sh (which this is modeled on): no Flussonic, no catalog, no seed
# dump, no TLS/certbot branch at all — Jarvis's session cookie is hardcoded
# `secure: false` (see src/app/api/auth/login/route.ts) because it's an
# internal tool reached over a private network or tunnel, never the public
# internet. If that ever changes, this script needs a TLS path added before
# it's safe to put a real password behind it.
#
# Two ways to run it:
#
#   ops/deploy.sh <ssh-target>
#     From your own machine, driving a target over SSH (any host alias
#     already in ~/.ssh/config works) — clones this repo onto the target
#     itself as part of provisioning, so nothing needs to exist there first.
#
#   ops/deploy.sh --local
#     Run ON the box you're provisioning, from inside a checkout you already
#     cloned there yourself — as root (apt/systemctl/postgres all need it).
#     Operates in place on that checkout rather than cloning a fresh copy
#     from origin, so this also works when the current checkout has local
#     commits that were never pushed.
#
# First run against a host (either way): full first-time setup (packages,
# Postgres role, a local checkout of the OTT platform repo — see
# OTT_REPO_PATH below — .env, nginx, pm2, a nightly DB backup cron). Every
# later run against the same host: detected by whether .env already exists,
# and just pulls, rebuilds, migrates and reloads — safe to re-run for
# routine updates. (--local's "pull" is a real `git pull origin` too, same
# as the SSH path — only the very first run skips it, using the checkout
# as-is instead.)
#
# If this repo's git remote is private, the target VM needs its own
# credentials (deploy key / PAT) to fetch future updates — this script does
# not set that up. Same applies to the OTT platform repo cloned below.
# Neither clone has anything to do with Jarvis's own SSH identity
# (JARVIS_SSH_KEY_PATH) — that key is generated automatically on first use
# and is only ever used for the *outbound* connections Jarvis makes to the
# branded deployments it manages (see README.md's "Registering a new
# server" section).
set -euo pipefail

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
OTT_CLONE_DIR="/srv/ott-repo"

LOCAL_MODE=false
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_MODE=true ;;
    *) TARGET="$arg" ;;
  esac
done

if [[ "$LOCAL_MODE" == true ]]; then
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Error: --local must be run as root (apt/systemctl/postgres all need it) — try: sudo ops/deploy.sh --local" >&2
    exit 1
  fi
  # Operates on the checkout this script is already running from, wherever
  # that is — no separate clone/copy step for Jarvis's own code at all, so a
  # checkout with commits that were never pushed to origin deploys exactly
  # as it sits.
  INSTALL_DIR="$(git rev-parse --show-toplevel)"
  BRANCH="$(git branch --show-current)"
elif [[ -z "$TARGET" ]]; then
  read -rp "SSH target (alias from ~/.ssh/config, or user@host): " TARGET
fi

if [[ "$LOCAL_MODE" == false ]]; then
  REPO_URL="$(git remote get-url origin)"
  BRANCH="$(git branch --show-current)"
  INSTALL_DIR="/srv/jarvis"
fi

# Runs the heredoc script piped into it either over SSH or directly, so the
# provisioning body below is written once and used by both modes.
run_provision_script() {
  if [[ "$LOCAL_MODE" == true ]]; then
    bash -s
  else
    ssh "$TARGET" bash -s
  fi
}

DEPLOY_LABEL="$TARGET"
[[ "$LOCAL_MODE" == true ]] && DEPLOY_LABEL="this box"

# --- already deployed? just update ------------------------------------------

ALREADY_DEPLOYED=false
if [[ "$LOCAL_MODE" == true ]]; then
  [[ -f "$INSTALL_DIR/.env" ]] && ALREADY_DEPLOYED=true
else
  ssh "$TARGET" "test -f $INSTALL_DIR/.env" 2>/dev/null && ALREADY_DEPLOYED=true
fi

if [[ "$ALREADY_DEPLOYED" == true ]]; then
  echo "==> Existing deploy found at $DEPLOY_LABEL:$INSTALL_DIR — updating."

  run_provision_script <<EOF
set -euo pipefail
cd $INSTALL_DIR
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH
echo "Deployed commit: \$(git rev-parse HEAD)"

pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm build
mkdir -p logs

# "pm2 startOrReload" assumes the apps are already registered from a prior
# completed first-time setup — self-heals in place if a previous attempt
# wrote .env but died before ever calling "pm2 start" (e.g. pnpm install
# getting OOM-killed): starts fresh if nothing's registered, gracefully
# reloads in place if it is.
pm2 startOrReload ops/ecosystem.config.js
pm2 save

if [ -d "$OTT_CLONE_DIR/.git" ]; then
  echo "==> Refreshing the OTT platform repo checkout at $OTT_CLONE_DIR (used by the Deploy action)..."
  git -C $OTT_CLONE_DIR fetch origin
  git -C $OTT_CLONE_DIR checkout main
  git -C $OTT_CLONE_DIR pull origin main
else
  echo "==> WARNING: $OTT_CLONE_DIR is missing — the Deploy action for every registered deployment will fail" >&2
  echo "    with 'OTT_REPO_PATH is not set' until it's cloned by hand: git clone <ott-repo-url> $OTT_CLONE_DIR" >&2
fi
EOF
  echo "==> Update complete: $DEPLOY_LABEL"
  exit 0
fi

echo "==> No existing deploy at $DEPLOY_LABEL:$INSTALL_DIR — running first-time setup."
echo

# --- prompts -----------------------------------------------------------------

read -rp "This box's hostname or IP (used as nginx's server_name — plain HTTP only, see header comment): " HOST_NAME
while [[ -z "$HOST_NAME" ]]; do
  read -rp "  required — hostname or IP: " HOST_NAME
done

read -rp "OTT platform repo URL (cloned onto this box for the Deploy action, e.g. git@github.com:you/ott.git): " OTT_REPO_URL
while [[ -z "$OTT_REPO_URL" ]]; do
  read -rp "  required — OTT platform repo URL: " OTT_REPO_URL
done

read -rp "Admin login email [admin@jarvis.local]: " SEED_ADMIN_EMAIL
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@jarvis.local}"

read -rp "TMDB API key (blank = TMDB lookup disabled; ingested content lands unpublished for manual review instead): " TMDB_API_KEY

# --- generate secrets ---------------------------------------------------------

SEED_ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
DB_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9')"
JARVIS_SESSION_SECRET="$(openssl rand -base64 48)"

# --- render .env ---------------------------------------------------------------

cat > "$SCRATCH/.env" <<ENV
DATABASE_URL=postgresql://jarvis:${DB_PASSWORD}@localhost:5432/jarvis?schema=public

JARVIS_SESSION_SECRET=${JARVIS_SESSION_SECRET}

SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}

OTT_REPO_PATH=${OTT_CLONE_DIR}

# Generated automatically on first use — see README.md's "Registering a new
# server" section. Left unset so the default (~/.ssh/jarvis_ed25519 etc, i.e.
# /root/.ssh/... on this box) applies.
JARVIS_SSH_KEY_PATH=
JARVIS_SSH_KNOWN_HOSTS_PATH=

TMDB_API_KEY=${TMDB_API_KEY}
ENV

# --- render nginx config -------------------------------------------------------

# Written with a placeholder + sed rather than direct interpolation into the
# heredoc, deliberately: nginx's own $host/$request_uri/etc. must reach the
# file untouched, and mixing bash interpolation into the same heredoc as
# those is exactly how they end up as literal "\$host" in a live config (see
# the OTT platform's own deploy.sh, which hit this once for real).
cat > "$SCRATCH/nginx.conf" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name __HOST_NAME__;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    client_max_body_size 5M;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_cache_valid 200 60m;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
NGINX
sed -i.bak "s|__HOST_NAME__|${HOST_NAME}|g" "$SCRATCH/nginx.conf"
rm -f "$SCRATCH/nginx.conf.bak"

# --- stage config files --------------------------------------------------------

# Remote mode needs these copied over; local mode is already on the same
# filesystem, so the scratch paths themselves are the staged paths.
if [[ "$LOCAL_MODE" == true ]]; then
  ENV_STAGED="$SCRATCH/.env"
  NGINX_STAGED="$SCRATCH/nginx.conf"
else
  echo "==> Copying config to $TARGET..."
  scp "$SCRATCH/.env" "$TARGET:/tmp/jarvis.env"
  scp "$SCRATCH/nginx.conf" "$TARGET:/tmp/jarvis-nginx.conf"
  ENV_STAGED="/tmp/jarvis.env"
  NGINX_STAGED="/tmp/jarvis-nginx.conf"
fi

# --- provision -----------------------------------------------------------------

# Built as a plain string (not a heredoc) so $INSTALL_DIR/$BRANCH/$REPO_URL
# expand now, at construction time, while \$(git rev-parse HEAD) stays
# literal text — to be evaluated later, by whichever bash actually runs this
# (see run_provision_script), not by this one while building the string.
if [[ "$LOCAL_MODE" == true ]]; then
  CLONE_OR_CD="cd \"$INSTALL_DIR\"
echo \"Deployed commit: \$(git rev-parse HEAD)\""
else
  CLONE_OR_CD="mkdir -p $INSTALL_DIR
cd $INSTALL_DIR
if [ -d .git ]; then
  git fetch origin && git checkout $BRANCH && git pull origin $BRANCH
else
  git clone --branch $BRANCH $REPO_URL .
fi
echo \"Deployed commit: \$(git rev-parse HEAD)\""
fi

run_provision_script <<EOF
set -euo pipefail

apt update -qq

# pnpm install below downloads Prisma's query-engine binaries alongside the
# rest of the toolchain — on a 1-2GB box with no swap that can get
# OOM-killed partway through, leaving things half-provisioned (hit this for
# real on the OTT platform's own first VPS). Idempotent: skipped if swap is
# already configured.
if [ "\$(swapon --show | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt install -y -qq nginx postgresql git curl sshpass
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null; apt install -y -qq nodejs; }
# Pinned, not "npm i -g pnpm" (unpinned): an unpinned install grabbed whatever
# the latest major happened to be the day this ran, which changed how it
# reads build-script approval config (moved from package.json's "pnpm" field
# to pnpm-workspace.yaml between versions) and broke "pnpm install
# --frozen-lockfile" with ERR_PNPM_IGNORED_BUILDS on a fresh box. Pinned to
# the version this repo is actually developed and tested against.
command -v pnpm >/dev/null || npm i -g pnpm@10.8.0 >/dev/null
command -v pm2  >/dev/null || npm i -g pm2  >/dev/null

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='jarvis'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER jarvis WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='jarvis'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE jarvis OWNER jarvis;"

$CLONE_OR_CD

mv $ENV_STAGED .env

pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm build
pnpm seed
mkdir -p logs

# Required for the Deploy action against any registered deployment — see
# provisioner.ts, which shells out to \$OTT_REPO_PATH/ops/deploy.sh over SSH.
if [ ! -d "$OTT_CLONE_DIR/.git" ]; then
  echo "==> Cloning the OTT platform repo to $OTT_CLONE_DIR..."
  git clone ${OTT_REPO_URL} $OTT_CLONE_DIR
fi

cp $NGINX_STAGED /etc/nginx/sites-available/jarvis
ln -sf /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/jarvis
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

pm2 start ops/ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

# Nightly backup of Jarvis's own database. This control plane is the ONLY
# place a registered deployment's SSH config and contentApiKey exist —
# losing it (which happened for real once already, with no way to recover
# the lost rows) means re-registering every deployment and re-minting every
# key by hand. Runs as the postgres OS user (native peer-auth access to any
# local database, no password needed), 14-day retention, gzip'd.
mkdir -p /var/backups/jarvis
chown postgres:postgres /var/backups/jarvis
cat > /etc/cron.d/jarvis-backup <<'CRON'
0 3 * * * postgres pg_dump jarvis | gzip > /var/backups/jarvis/jarvis-\$(date +\%Y\%m\%d).sql.gz && find /var/backups/jarvis -name '*.sql.gz' -mtime +14 -delete
CRON
chmod 644 /etc/cron.d/jarvis-backup
EOF

echo
echo "=================================================================="
echo " Deploy complete: http://${HOST_NAME}"
echo "------------------------------------------------------------------"
echo " Admin login:    ${SEED_ADMIN_EMAIL}"
echo " Admin password: ${SEED_ADMIN_PASSWORD}"
echo " DB password:    ${DB_PASSWORD}   (only needed for direct psql access)"
echo "------------------------------------------------------------------"
echo " Full .env lives at ${DEPLOY_LABEL}:${INSTALL_DIR}/.env — save the above,"
echo " it is not printed again."
echo
echo " Nightly DB backups: /var/backups/jarvis/*.sql.gz on ${DEPLOY_LABEL}, 14-day"
echo " retention (/etc/cron.d/jarvis-backup). Copy these off-box periodically"
echo " — a backup that only ever lives on the box it protects survives every"
echo " failure except the one that destroys the box."
echo
echo " Before registering any deployment: open http://${HOST_NAME}/deployments,"
echo " copy Jarvis's SSH public key (also at GET /api/ssh-identity) into each"
echo " target's ~/.ssh/authorized_keys, or use the password-bootstrap option"
echo " on that deployment's row (needs sshpass — already installed above)."
echo "=================================================================="
