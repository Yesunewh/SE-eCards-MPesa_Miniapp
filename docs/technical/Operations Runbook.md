---
title: Operations Runbook
tags: [ecards, technical, ops]
---

# Operations Runbook

Back to [[00 Home]] · Context: [[Infrastructure and Deployment]]

All commands are for the VPS `91.107.204.59`, run as a sudo user.

## Is it up?
```bash
curl -s http://127.0.0.1:10011/health
```
```bash
curl -s https://ecards.paperless.et/health
```
```bash
systemctl status ecards-api --no-pager
```

## Logs
```bash
journalctl -u ecards-api -n 200 --no-pager
```
```bash
journalctl -u ecards-api -f
```

## Restart
```bash
sudo systemctl restart ecards-api
```

## Update to the latest code (keeps keys and data; rolls back automatically on failure)
```bash
cd ~/ecards-src && git pull && cd server && bash deploy/pack.sh
```
```bash
cd ~/ecards-src/server && ECARDS_DATABASE_URL="postgres://ecards:$(cat /root/ecards-db.pass)@127.0.0.1:5433/ecards" bash deploy/install.sh release/ecards-server.tar.gz
```
Migrations run automatically during the update.

## Edit settings
```bash
sudo nano /opt/ecards/.env
```
```bash
sudo systemctl restart ecards-api
```

## Create another admin
```bash
sudo bash -c 'set -a; . /opt/ecards/.env; set +a; cd /opt/ecards/current && ADMIN_PASSWORD="choose-a-long-one" /opt/ecards/node/bin/node dist/scripts/create-admin.js person@paperless.et "Full Name" admin'
```
Roles: `owner`, `admin`, `support`, `viewer`.

## Staging: approve a mock payment by hand
```bash
sudo grep DEV_SIMULATE_KEY /opt/ecards/.env
```
Or open the app with `https://ecards.paperless.et/?devkey=<that key>` and payments approve themselves. See [[Demo Guide – Technical]].

## Database
Open a SQL shell:
```bash
docker exec -it ecards-db psql -U ecards ecards
```
Back up (do this daily, and before every update):
```bash
docker exec ecards-db pg_dump -U ecards -Fc ecards > ~/ecards-$(date +%F).dump
```
Restore (to an empty database):
```bash
docker exec -i ecards-db pg_restore -U ecards -d ecards --clean < ~/ecards-YYYY-MM-DD.dump
```
> [!important] Back up `/opt/ecards/.env` too, kept apart from the dumps. `CODE_ENCRYPTION_KEY` is needed to read stocked codes.

## Useful SQL
```sql
-- orders today by status
SELECT status, count(*) FROM orders WHERE created_at > current_date GROUP BY 1;
-- stock per product
SELECT * FROM product_stock ORDER BY codes_available;   -- also shows preorders_owed
-- stuck jobs
SELECT id, type, status, attempts, last_error, run_at FROM jobs WHERE status IN ('queued','dead') ORDER BY run_at;
-- unmatched / problem payments (also in Admin → Payments review)
SELECT source, error, received_at FROM webhook_events WHERE error IS NOT NULL ORDER BY received_at DESC LIMIT 20;
```

## M-Pesa
- Register callback URLs: see [[Payments – M-Pesa Ethiopia#Registering the callback URLs]].
- Test the token (sandbox). The key and secret come from `.env`:
```bash
sudo bash -c 'set -a; . /opt/ecards/.env; curl -s -u "$MPESA_CONSUMER_KEY:$MPESA_CONSUMER_SECRET" "$MPESA_BASE_URL/v1/token/generate?grant_type=client_credentials"'
```

## Wupex
Sync the catalogue, add the values Wupex sells, and map them (shows the result first; `--apply` saves):
```bash
sudo bash -c 'set -a; . /opt/ecards/.env; set +a; cd /opt/ecards/current && /opt/ecards/node/bin/node dist/scripts/provider-map.js wupex --add-values --apply'
```
Check the API key and the balance straight from the server:
```bash
sudo bash -c 'set -a; . /opt/ecards/.env; curl -s -H "x-api-key: $WUPEX_API_KEY" -H "Accept-Language: en" "$WUPEX_BASE_URL/api/customer/balance"'
```
Open Wupex pre-orders (re-read every 2 minutes; codes go to the customer as they arrive):
```sql
SELECT custom_identifier, status, external_transaction_id, created_at FROM provider_orders WHERE status IN ('partial','unknown') ORDER BY created_at;
```
You can also use **Admin → Providers** (balance, sync, auto-map, call log).

## If something goes wrong
| Symptom | Look at |
|---|---|
| A paid order has no code | Admin → Orders → the order → Retry. Check `jobs` for `dead`, and the provider log. |
| The customer paid but the order is still unpaid | Admin → Payments review (amount mismatch or unknown reference). Check `webhook_events`. |
| The app shows demo data | The page did not find the API. Check `/health` and nginx. |
| Service won't start | `journalctl -u ecards-api -n 100`. Usually a bad `.env` value (zod prints which one). |

## Remove everything (careful)
```bash
sudo bash /opt/ecards/current/deploy/uninstall.sh
```
The container DB is not dropped automatically. To delete it, remove it on purpose: `docker rm -f ecards-db`, then `docker volume rm ecards-pgdata`.
