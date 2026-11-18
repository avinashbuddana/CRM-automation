#!/bin/sh
set -eu

: "${DATABASE_URL:?Missing DATABASE_URL}"
: "${REDIS_URL:?Missing REDIS_URL}"
: "${WHATOMATE_DATABASE__USER:?Missing PostgreSQL username}"
: "${WHATOMATE_DATABASE__PASSWORD:?Missing PostgreSQL password}"
: "${WHATOMATE_DEFAULT_ADMIN__PASSWORD:?Missing admin password}"
: "${RENDER_EXTERNAL_URL:?Missing Render public service URL}"

# Private Render Postgres URLs may omit the default port.
db_url=${DATABASE_URL#*://}
db_location=${db_url#*@}
db_hostport=${db_location%%/*}
db_path=${db_location#*/}
export WHATOMATE_DATABASE__HOST=${db_hostport%%:*}
if [ "$db_hostport" = "${db_hostport%%:*}" ]; then
  export WHATOMATE_DATABASE__PORT=5432
else
  export WHATOMATE_DATABASE__PORT=${db_hostport##*:}
fi
export WHATOMATE_DATABASE__NAME=${db_path%%\?*}
export WHATOMATE_DATABASE__SSL_MODE=require

redis_scheme=${REDIS_URL%%://*}
redis_url=${REDIS_URL#*://}
redis_location=${redis_url#*@}
redis_hostport=${redis_location%%/*}
export WHATOMATE_REDIS__HOST=${redis_hostport%%:*}
if [ "$redis_hostport" = "${redis_hostport%%:*}" ]; then
  export WHATOMATE_REDIS__PORT=6379
else
  export WHATOMATE_REDIS__PORT=${redis_hostport##*:}
fi
if [ "$redis_scheme" = "rediss" ]; then
  export WHATOMATE_REDIS__TLS=true
else
  export WHATOMATE_REDIS__TLS=false
fi
if [ "$redis_url" != "$redis_location" ]; then
  redis_auth=${redis_url%%@*}
  if [ "$redis_auth" != "${redis_auth#*:}" ]; then
    export WHATOMATE_REDIS__USERNAME=${redis_auth%%:*}
    export WHATOMATE_REDIS__PASSWORD=${redis_auth#*:}
  else
    export WHATOMATE_REDIS__PASSWORD=$redis_auth
  fi
fi

export WHATOMATE_SERVER__HOST=0.0.0.0
export WHATOMATE_SERVER__PORT=${PORT:-8080}
export WHATOMATE_SERVER__ALLOWED_ORIGINS=${RENDER_EXTERNAL_URL}

exec /app/whatomate server -config /app/config.toml -migrate
