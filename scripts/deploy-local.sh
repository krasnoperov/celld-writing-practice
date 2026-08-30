#!/bin/sh
# Deploy to the production celld node on this host (s3://writing-coach via
# the local MinIO). Bucket credentials come from the celld-minio container's
# environment at run time; nothing is stored in the repo or printed.
#
# Before deploying, the writer state (cells/) is snapshotted to
# ~/backups/writing-coach/<utc-timestamp>/cells — this step is mandatory
# (see AGENTS.md) and the deploy aborts if it fails.
set -eu
cd "$(dirname "$0")/.."
minio_env() {
  docker inspect celld-minio --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$1=//p"
}
export RCLONE_CONFIG_M_TYPE=s3
export RCLONE_CONFIG_M_PROVIDER=Minio
export RCLONE_CONFIG_M_ENDPOINT="http://127.0.0.1:9000"
export RCLONE_CONFIG_M_ACCESS_KEY_ID="$(minio_env MINIO_ROOT_USER)"
export RCLONE_CONFIG_M_SECRET_ACCESS_KEY="$(minio_env MINIO_ROOT_PASSWORD)"

backup_dir="${BACKUP_DIR:-$HOME/backups/writing-coach}/$(date -u +%Y%m%dT%H%M%SZ)"
echo "Backing up writer state to $backup_dir/cells"
rclone copy m:writing-coach/cells "$backup_dir/cells" --quiet
echo "Backed up $(find "$backup_dir/cells" -type f | wc -l) objects."

AWS_ACCESS_KEY_ID="$RCLONE_CONFIG_M_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$RCLONE_CONFIG_M_SECRET_ACCESS_KEY" \
AWS_REGION=auto \
npm run deploy -- --bucket s3://writing-coach --endpoint http://127.0.0.1:9000

echo "Deployed. Now restart the node to serve this version:"
echo "  sudo systemctl restart celld-writing-coach"
