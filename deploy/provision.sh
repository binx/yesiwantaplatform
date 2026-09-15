#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 droplet for postcardgifts.com.
#
# Run once as root, from this directory, with the domain as the argument:
#
#   scp -r deploy root@SERVER_IP:/root/deploy
#   ssh root@SERVER_IP 'bash /root/deploy/provision.sh postcardgifts.com'
#
# Safe to run again: every step checks before it changes anything, and the
# .env with the secrets in it is never overwritten.
#
# What it sets up:
#   - Node 22, Caddy, sqlite3, a 2 GB swap file (the build needs it on 1 GB)
#   - a `postcards` user with root's ssh keys, owning /srv/postcards
#   - a bare git repo whose post-receive hook builds and restarts:
#       git remote add production postcards@SERVER_IP:/srv/postcards/repo.git
#       git push production main
#   - the systemd service, the nightly database backup, ufw

set -euo pipefail

DOMAIN=${1:-}
if [ -z "$DOMAIN" ]; then
	echo "usage: provision.sh DOMAIN" >&2
	exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
	echo "Run as root." >&2
	exit 1
fi

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=/srv/postcards
SERVER_IP=$(curl -fsS -4 https://api.ipify.org || hostname -I | awk '{print $1}')
STAGING_HOST=$(echo "$SERVER_IP" | tr . -).sslip.io

export DEBIAN_FRONTEND=noninteractive

step() { printf '\n==> %s\n' "$*"; }

# --- swap -------------------------------------------------------------------
# `npm run build` (tsc + vite over antd) wants more than the 1 GB the
# smallest droplet has. Swap makes it slow rather than killed.
if ! swapon --show | grep -q /swapfile; then
	step "Adding a 2 GB swap file"
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
	sysctl -w vm.swappiness=10 >/dev/null
	grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# --- packages ---------------------------------------------------------------
step "Installing packages"
apt-get update -q
apt-get install -y -q curl git ufw sqlite3 build-essential python3 \
	debian-keyring debian-archive-keyring apt-transport-https gnupg

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v22" ]; then
	step "Installing Node 22 from NodeSource"
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y -q nodejs
fi
node -v && npm -v

if ! command -v caddy >/dev/null; then
	step "Installing Caddy"
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		> /etc/apt/sources.list.d/caddy-stable.list
	apt-get update -q
	apt-get install -y -q caddy
fi

# --- user and directories ---------------------------------------------------
if ! id postcards >/dev/null 2>&1; then
	step "Creating the postcards user"
	useradd --system --create-home --home-dir /home/postcards --shell /bin/bash postcards
fi
# Reads the service log with journalctl, without sudo.
usermod -aG systemd-journal postcards

# Same keys as root, so `git push production` and ssh work with the key
# that created the droplet.
install -d -m 700 -o postcards -g postcards /home/postcards/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
	install -m 600 -o postcards -g postcards /root/.ssh/authorized_keys /home/postcards/.ssh/authorized_keys
fi

step "Creating $ROOT"
install -d -o postcards -g postcards "$ROOT" "$ROOT/app" "$ROOT/data" "$ROOT/assets" "$ROOT/backups"

# --- bare repo + hook -------------------------------------------------------
if [ ! -d "$ROOT/repo.git" ]; then
	step "Creating the bare repository"
	sudo -u postcards git init --bare --initial-branch=main "$ROOT/repo.git" >/dev/null
fi
install -m 755 -o postcards -g postcards "$HERE/post-receive" "$ROOT/repo.git/hooks/post-receive"

# The hook restarts the service; nothing else needs root.
cat > /etc/sudoers.d/postcards <<SUDO
postcards ALL=(root) NOPASSWD: /usr/bin/systemctl restart postcards
SUDO
chmod 440 /etc/sudoers.d/postcards

# --- .env -------------------------------------------------------------------
if [ ! -f "$ROOT/.env" ]; then
	step "Writing $ROOT/.env (fill in the keys)"
	SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
	cat > "$ROOT/.env" <<ENV
# Production environment for postcardgifts.com. Read by systemd
# (EnvironmentFile) and by the server's dotenv. Same variables as
# .env.example in the repo. Restart after editing:
#   sudo systemctl restart postcards

API_PORT=4000
API_HOST=127.0.0.1
TRUST_PROXY=1
PUBLIC_URL=https://$DOMAIN
DATABASE_URL=file:$ROOT/data/postcards.sqlite
ASSETS_DIR=$ROOT/assets
SESSION_SECRET=$SESSION_SECRET

# Uncomment and fill in. A blank value is refused at boot; an absent one is
# a state the admin overview reports.
#
# Stripe: a live secret key, and the signing secret of a webhook endpoint in
# the Stripe dashboard pointed at https://$DOMAIN/api/webhooks/stripe.
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# Lob: a live_ key prints and mails; a test_ key talks to the sandbox.
# LOB_API_KEY=
# Signing secret of a Lob webhook pointed at https://$DOMAIN/api/webhooks/lob.
# LOB_WEBHOOK_SECRET=
LOB_USE_TYPE=operational

# Email. Until set, emails are logged instead of sent.
# SMTP_URL=
EMAIL_FROM="Postcard Gifts <hi@$DOMAIN>"
ENV
	chown postcards:postcards "$ROOT/.env"
	chmod 600 "$ROOT/.env"
fi

# --- systemd ----------------------------------------------------------------
step "Installing systemd units"
install -m 644 "$HERE/postcards.service" /etc/systemd/system/postcards.service
install -m 644 "$HERE/postcards-backup.service" /etc/systemd/system/postcards-backup.service
install -m 644 "$HERE/postcards-backup.timer" /etc/systemd/system/postcards-backup.timer
install -m 755 -o postcards -g postcards "$HERE/backup.sh" "$ROOT/backup.sh"
systemctl daemon-reload
systemctl enable postcards.service postcards-backup.timer >/dev/null
systemctl start postcards-backup.timer
# The service itself starts on the first `git push production`; there is
# nothing to run until then.

# --- caddy ------------------------------------------------------------------
step "Configuring Caddy for $DOMAIN (staging: $STAGING_HOST)"
sed -e "s/DOMAIN/$DOMAIN/g" -e "s/STAGING_HOST/$STAGING_HOST/g" -e "s/SERVER_IP/$SERVER_IP/g" \
	"$HERE/Caddyfile" > /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# validate runs as root and creates the access log; hand it back to caddy.
chown -R caddy:caddy /var/log/caddy
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

# --- firewall ---------------------------------------------------------------
step "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -n 8

cat <<DONE

Provisioned. Next, from your machine:

  git remote add production postcards@$SERVER_IP:/srv/postcards/repo.git
  git push production main

Then fill in the keys:

  ssh postcards@$SERVER_IP nano /srv/postcards/.env
  ssh postcards@$SERVER_IP sudo systemctl restart postcards

Before DNS points at this box, the site answers at https://$STAGING_HOST
DONE
