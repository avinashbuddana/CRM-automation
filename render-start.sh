#!/bin/sh
set -eu

: "${DATABASE_URL:?Missing DATABASE_URL}"
: "${REDIS_URL:?Missing REDIS_URL}"
: "${WHATOMATE_DATABASE__USER:?Missing PostgreSQL username}"
: "${WHATOMATE_DATABASE__PASSWORD:?Missing PostgreSQL password}"
: "${WHATOMATE_DEFAULT_ADMIN__PASSWORD:?Missing admin password}"
: "${RENDER_EXTERNAL_URL:?Missing Render public service URL}"

db_url=${DATABASE_URL#*://}
db_location=${db_url#*@}
db_hostport=${db_location%%/*}
db_path=${db_location#*/}
export WHATOMATE_DATABASE__HOST=${db_hostport%%:*}
export WHATOMATE_DATABASE__PORT=${db_hostport##*:}
export WHATOMATE_DATABASE__NAME=${db_path%%\?*}
export WHATOMATE_DATABASE__SSL_MODE=require

redis_url=${REDIS_URL#*://}
redis_location=${redis_url#*@}
redis_hostport=${redis_location%%/*}
export WHATOMATE_REDIS__HOST=${redis_hostport%%:*}
export WHATOMATE_REDIS__PORT=${redis_hostport##*:}
export WHATOMATE_REDIS__TLS=false

export WHATOMATE_SERVER__HOST=0.0.0.0
export WHATOMATE_SERVER__PORT=${PORT:-8080}
export WHATOMATE_SERVER__ALLOWED_ORIGINS=${RENDER_EXTERNAL_URL}

exec /app/whatomate server -config /app/config.toml -migrate
