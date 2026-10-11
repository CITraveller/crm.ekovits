# Deploy CRM on Ubuntu at crm.ekovits.com

This deployment is separate from Portal. It does not connect to or migrate Portal's database. Portal customer synchronization is not implemented in this release.

## 1. Pull the source

For an empty `~/crm.ekovits.com` directory:

```bash
cd ~/crm.ekovits.com
git init -b main
git remote add origin git@github.com:CITraveller/crm.ekovits.git
git pull --ff-only origin main
git branch --set-upstream-to=origin/main main
```

If already cloned, check `git remote -v` and `git status`, then run `git pull --ff-only origin main`. Do not overwrite a different remote or discard local changes. GitHub SSH access must be configured for the Ubuntu user.

## 2. Configure and start containers

Confirm ports 3006 and 5006 are free with `sudo ss -ltnp | grep -E ':(3006|5006)\b'`. No output means no listeners. These ports do not overlap with the container listing supplied for the existing websites.

```bash
cd ~/crm.ekovits.com
bash deploy/configure.sh
docker compose config --quiet
docker compose up -d --build
docker compose ps -a
curl -fsS http://127.0.0.1:5006/api/health
curl -I http://127.0.0.1:3006/
```

The configuration script generates unique database and administrator passwords in `.env` with owner-only permissions. It refuses to overwrite an existing `.env`. Do not copy the Windows development `.env` to the server. Never publish the output of `docker compose config` without `--quiet`, since it includes secrets.

Three services remain running: `crm_db`, `crm_backend`, and `crm_frontend`. `crm_migrate` should show `Exited (0)` after successfully creating the schema and restricted runtime database role. Compose-generated container names are prefixed with `ekovits_crm` to avoid collisions with other projects. The database has no published host port.

This creates a fresh server database. Local Windows customer data is not included in Git. Existing data can be migrated separately using a logical PostgreSQL dump after deciding which records to transfer; do not copy the Windows PostgreSQL data directory into the Linux container.

## 3. Connect the domain through host Nginx

First confirm the server uses host Nginx with `sudo nginx -t`. If it uses another reverse proxy, adapt that existing proxy instead of installing a competing one.

The Cloudflare A record should point to the server's public IPv4 address, not the private `172.26.*` address. For initial certificate setup, DNS-only mode is the simplest option. Only change the CRM record; preserve the existing sites' records and settings.

Check for an existing CRM site configuration before copying:

```bash
sudo ls -l /etc/nginx/sites-available/crm.ekovits.com /etc/nginx/sites-enabled/crm.ekovits.com
```

If neither exists:

```bash
sudo cp deploy/nginx-http.conf /etc/nginx/sites-available/crm.ekovits.com
sudo ln -s /etc/nginx/sites-available/crm.ekovits.com /etc/nginx/sites-enabled/crm.ekovits.com
sudo nginx -t && sudo systemctl reload nginx
```

If a CRM configuration already exists, review and back it up before merging this site's configuration. Do not change the default site or the Portal configuration.

## 4. Enable HTTPS

After DNS resolves and the HTTP site is reachable, use the server's existing Certbot installation:

```bash
sudo certbot --nginx -d crm.ekovits.com
sudo nginx -t
curl -fsS https://crm.ekovits.com/api/health
```

If Certbot is not installed, first confirm how certificates are managed for the existing sites. Do not replace their certificate setup. Ensure inbound ports 80/443 are permitted by the server firewall/security group; do not expose the database or application ports publicly.

Production login requires HTTPS because session cookies are Secure. `APP_ORIGIN` is fixed to `https://crm.ekovits.com` in Compose. Once the origin certificate is valid, Cloudflare can proxy the CRM record with Full (strict) TLS. Do not use Flexible TLS. Preserve existing zone-wide settings; use a hostname-specific configuration if needed. Bypass caching for `/api/*`; never cache authenticated API responses. The supplied host Nginx routes the API directly to port 5006 and replaces forwarded headers; Express trusts one proxy hop. If additional proxy layers or Cloudflare real-IP handling are added, review that trust boundary.

## 5. Sign in

Open https://crm.ekovits.com after HTTPS is enabled.

- Initial email: `admin@ekovits.com`
- View the generated initial password privately:

```bash
sed -n 's/^ADMIN_PASSWORD=//p' .env
```

The migration creates the initial administrator only for an empty users table. Changing `.env` afterward does not reset an existing administrator's password.

## Logs and updates

```bash
docker compose logs --tail=100 crm_migrate crm_backend crm_frontend
```

Before updates, take a CRM backup (the destination folder must be private):

```bash
umask 077
mkdir -p ~/backups/crm.ekovits.com
docker compose exec -T crm_db pg_dump -U crm_owner -d crm_module -Fc > ~/backups/crm.ekovits.com/crm-$(date +%Y%m%d-%H%M%S).dump
```

Confirm the dump command succeeded and the file is non-empty. Preserve the server `.env` securely as well. Then:

```bash
git pull --ff-only origin main
docker compose build
docker compose run --rm crm_migrate
docker compose up -d
docker compose ps -a
curl -fsS http://127.0.0.1:5006/api/health
```

Stop if a command fails. Do not run `docker compose down -v`: it deletes the CRM database volume. `docker compose down` without `-v` preserves the database. Run these commands only from the CRM project directory.

## Reference documentation

- PostgreSQL 18 image storage: https://hub.docker.com/_/postgres
- Express proxy trust: https://expressjs.com/en/guide/behind-proxies/
- Cloudflare Full (strict): https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/

The Docker build and container startup must be verified on the Ubuntu host if Docker is not available on the workstation preparing this repository.
