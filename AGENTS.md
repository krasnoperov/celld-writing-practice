# Agent operating contract

This repository's production instance runs on the same host it is developed on:
systemd unit `celld-writing-coach` serves `s3://writing-coach` from the local
MinIO (`celld-minio` docker container) and listens on `127.0.0.1:8931`, behind
Caddy at https://writing.krasnoperov.me/.

## Backups are mandatory

Writer data (pieces, letters, accounts) lives as LTX segments under
`s3://writing-coach/cells/`. **Before any operation that touches production
state or the running service — deploys, env edits, restarts, migrations,
anything under `cells/` — snapshot the state first.** `scripts/deploy-local.sh`
does this automatically and aborts if the backup fails; never bypass it by
running `celld deploy` directly against production.

Backups land in `~/backups/writing-coach/<utc-timestamp>/`. Manual snapshot,
when needed outside a deploy, uses the same rclone remote the script builds
from the `celld-minio` container credentials.

Never delete objects under `cells/` — not even ones that look orphaned.

## Deploying

**The wrangler `name` must stay `"writing-coach"`.** celld namespaces every
Durable Object cell by the script name; deploying under any other name detaches
the app from all production state — every shelf and account comes up empty
while the data sits untouched under the old namespace. This happened on
2026-08-30 when the repo briefly deployed as `writing-practice`.

1. `scripts/deploy-local.sh` — runs the backup, predeploy tests
   (`npm test && npm run check`), and `celld deploy`.
2. `sudo systemctl restart celld-writing-coach` — nodes load a deployment
   only at startup.
3. Verify: `curl http://127.0.0.1:8931/api/health` and confirm the served
   HTML references the new hashed `app-*.js` from the build output.

## Runtime configuration

Secrets and settings live in root-only `/etc/celld-writing-coach/env`
(plus `github-app-env`); edits require a service restart. Admin access to the
app is `CELLD_VAR_ADMIN_GITHUB_IDS` — comma-separated numeric GitHub IDs.
Polar billing is not configured (`billingConfigured: false` is expected);
without an admin ID every signed-in user hits the billing gate.
