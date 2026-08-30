#!/bin/sh
# Deploy to the production celld node on this host (s3://writing-coach via
# the local MinIO). Bucket credentials come from the celld-minio container's
# environment at run time; nothing is stored in the repo or printed.
set -eu
cd "$(dirname "$0")/.."
minio_env() {
  docker inspect celld-minio --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$1=//p"
}
AWS_ACCESS_KEY_ID="$(minio_env MINIO_ROOT_USER)" \
AWS_SECRET_ACCESS_KEY="$(minio_env MINIO_ROOT_PASSWORD)" \
AWS_REGION=auto \
npm run deploy -- --bucket s3://writing-coach --endpoint http://127.0.0.1:9000
