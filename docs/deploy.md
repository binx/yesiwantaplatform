# Deploying

postcardgifts.com runs on one DigitalOcean droplet: Ubuntu 24.04, Node 22,
SQLite and uploaded imagery on the droplet's disk, Caddy for TLS, systemd
keeping the process up. Deploys are `git push production main`, the way v1
worked. Everything the box needs is in `deploy/`.

```
deploy/provision.sh          one-time setup of a fresh droplet (idempotent)
deploy/post-receive          the git hook: checkout, npm ci, build, restart
deploy/postcards.service     systemd unit for the API
deploy/Caddyfile             TLS and reverse proxy; provision.sh fills the domain in
deploy/backup.sh + .timer    nightly SQLite backup, fourteen days kept
```

On the box:

```
/srv/postcards/.env          the environment — the only file with secrets in it
/srv/postcards/app           the checked-out code, built in place
/srv/postcards/data          postcards.sqlite
/srv/postcards/assets        uploads: store images, print files, thumbnails
/srv/postcards/backups       nightly database copies
/srv/postcards/repo.git      what `git push production` pushes to
```

## Creating the droplet

Once, with [doctl](https://docs.digitalocean.com/reference/doctl/) authenticated:

```bash
doctl compute ssh-key import postcards --public-key-file ~/.ssh/id_ed25519.pub
doctl compute droplet create postcardgifts \
  --region sfo3 --size s-1vcpu-1gb --image ubuntu-24-04-x64 \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | tr '\n' ',' | sed 's/,$//')" \
  --enable-backups --enable-monitoring --tag-name postcards --wait
doctl compute droplet list --format Name,PublicIPv4
```

Then provision it:

```bash
scp -r deploy root@SERVER_IP:/root/deploy
ssh root@SERVER_IP 'bash /root/deploy/provision.sh postcardgifts.com'
```

The script prints what to do next. It never overwrites `/srv/postcards/.env`,
so it can be run again after a change to any file in `deploy/`.

## Deploying

```bash
git remote add production postcards@SERVER_IP:/srv/postcards/repo.git   # once
git push production main
```

The hook checks main out into `/srv/postcards/app`, runs `npm ci` and
`npm run build`, restarts the service, and prints the health check. Only
`main` deploys. Migrations run when the server boots. Expect a few seconds
of 502 while it restarts.

## Secrets

Fill in `/srv/postcards/.env` on the box and restart:

```bash
ssh postcards@SERVER_IP
nano /srv/postcards/.env
sudo systemctl restart postcards
```

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` — a webhook endpoint in the
  Stripe dashboard pointed at `https://postcardgifts.com/api/webhooks/stripe`,
  subscribed to `checkout.session.completed`, `checkout.session.expired`
  and `charge.refunded`.
- `LOB_API_KEY` — `live_` to print, `test_` for the sandbox.
- `LOB_WEBHOOK_SECRET` — a Lob webhook pointed at
  `https://postcardgifts.com/api/webhooks/lob`, for delivery tracking.
- `SMTP_URL` and `EMAIL_FROM`.

The Stripe publishable key and the price are entered in the setup wizard and
Settings, not here. The admin overview lists whichever of these is missing.

## First run

After the first push the store is unconfigured. The server prints a one-off
setup token to its log:

```bash
ssh postcards@SERVER_IP journalctl -u postcards -n 30 --no-pager
```

Open `https://postcardgifts.com/setup` (or the staging host, below), paste
the token, and create the administrator. A restart prints a new token; the
wizard stops asking once an administrator exists.

## DNS

The registrar (iwantmyname) holds the zone. Point `postcardgifts.com` and
`www` A records at the droplet. Caddy fetches the certificates on its own
once the names resolve here. Both names are served; `PUBLIC_URL` decides
which one emails and Stripe redirects use.

Before the records change, the same site answers at
`https://<ip-with-dashes>.sslip.io` (printed by provision.sh) with a real
certificate, so the wizard and a test order can be tried first. Stripe's
success redirect still goes to `PUBLIC_URL`, so a full paid checkout is only
worth trying after DNS.

## Operating

```bash
ssh postcards@SERVER_IP
journalctl -u postcards -f                 # the app log; Lob's answers land here
sudo systemctl restart postcards
ls /srv/postcards/backups                  # nightly copies
sqlite3 /srv/postcards/data/postcards.sqlite
```

Droplet backups (weekly, DigitalOcean's) cover the disk including the
uploads; the nightly SQLite copies are the fine-grained safety net. To
restore: stop the service, `gunzip` a backup over `data/postcards.sqlite`,
start it.

The build wants more memory than the 1 GB droplet has; provision.sh adds a
2 GB swap file so it finishes rather than dies. If deploys get too slow,
`doctl compute droplet-action resize` to `s-1vcpu-2gb` and drop the swap.

Ubuntu's unattended-upgrades handles security patches. Node and Caddy come
from their own apt repositories and update with `apt upgrade`.
