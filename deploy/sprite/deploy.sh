#!/bin/bash
# Nexus Commerce — native deployment inside a Fly.io Sprite, supervised.
# Docker-in-Sprite is unreliable (sandbox blocks setns/netns), so services run
# natively and supervisord keeps them alive (autorestart on crash).
# Prereqs: repo at ~/nexus-commerce, strong secrets in .env, and packages:
#   sudo apt-get install -y postgresql redis-server rabbitmq-server nginx maven supervisor
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
LOGS=$HOME/nexus-logs; BIN=$HOME/nexus-bin; SUP=$HOME/supervisor
mkdir -p "$LOGS" "$BIN" "$SUP/conf.d"
chmod 700 "$SUP"
set -a; source .env; set +a
: "${INTERNAL_TOKEN:?INTERNAL_TOKEN must be set in .env (service-to-service auth)}"
export JWT_SECRET INTERNAL_TOKEN

wait_http() {
  for i in $(seq 1 40); do curl -sf "$1" > /dev/null 2>&1 && { echo "$2 up"; return; }; sleep 2; done
  echo "WARN: $2 not responding at $1 — see $LOGS"
}

echo "== infrastructure =="
sudo service postgresql start || true
mkdb() {
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$1'" | grep -q 1 \
    || sudo -u postgres psql -q -c "CREATE USER $1 WITH PASSWORD '$2'"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$3'" | grep -q 1 \
    || sudo -u postgres createdb -O "$1" "$3"
}
mkdb identity_user "$IDENTITY_DB_PASSWORD" identity_db
mkdb product_user "$PRODUCT_DB_PASSWORD" product_db
mkdb inventory_user "$INVENTORY_DB_PASSWORD" inventory_db
mkdb order_user "$ORDER_DB_PASSWORD" order_db
mkdb payment_user "$PAYMENT_DB_PASSWORD" payment_db
mkdb notification_user "$NOTIFICATION_DB_PASSWORD" notification_db
mkdir -p "$HOME/redis-data"
redis-cli -h 127.0.0.1 ping > /dev/null 2>&1 || redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --appendonly yes --dir "$HOME/redis-data"
sudo service rabbitmq-server start || true
for i in $(seq 1 30); do sudo rabbitmqctl status > /dev/null 2>&1 && break; sleep 2; done
sudo rabbitmqctl add_user "$RABBITMQ_USER" "$RABBITMQ_PASSWORD" 2>/dev/null || sudo rabbitmqctl change_password "$RABBITMQ_USER" "$RABBITMQ_PASSWORD"
sudo rabbitmqctl set_user_tags "$RABBITMQ_USER" administrator || true
sudo rabbitmqctl set_permissions -p / "$RABBITMQ_USER" ".*" ".*" ".*" || true

echo "== builds (always, never stale) =="
(cd services/identity && mvn -q -DskipTests package)
for s in inventory payment order; do (cd "services/$s" && go build -o "$BIN/$s" .); done
[ -d "$HOME/nexus-venv" ] || python3 -m venv "$HOME/nexus-venv"
"$HOME/nexus-venv/bin/pip" install -q -r services/product/requirements.txt -r services/cart/requirements.txt -r services/notification/requirements.txt
(cd services/api-gateway && npm ci --silent && npm run build --silent)
(cd frontend && npm ci --silent && VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-} npm run build --silent)

echo "== supervisor configuration =="
cat > "$SUP/supervisord.conf" <<EOF
[unix_http_server]
file=$SUP/supervisor.sock
[supervisord]
logfile=$LOGS/supervisord.log
pidfile=$SUP/supervisord.pid
nodaemon=false
[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface
[supervisorctl]
serverurl=unix://$SUP/supervisor.sock
[include]
files = $SUP/conf.d/*.conf
EOF

prog() { # name command envpairs...
  local name=$1 cmd=$2; shift 2
  {
    echo "[program:$name]"
    echo "command=$cmd"
    echo "directory=$REPO"
    printf 'environment=%s\n' "$*"
    echo "autostart=true"
    echo "autorestart=true"
    echo "startretries=10"
    echo "stopwaitsecs=10"
    echo "stdout_logfile=$LOGS/$name.log"
    echo "stderr_logfile=$LOGS/$name.log"
    echo "redirect_stderr=true"
  } > "$SUP/conf.d/$name.conf"
  chmod 600 "$SUP/conf.d/$name.conf"
}

VENV=$HOME/nexus-venv/bin
prog identity "java -jar $REPO/services/identity/target/identity-0.1.0.jar" \
  "DB_HOST=\"localhost\",DB_PORT=\"5432\",DB_NAME=\"identity_db\",DB_USER=\"identity_user\",DB_PASSWORD=\"$IDENTITY_DB_PASSWORD\",JWT_SECRET=\"$JWT_SECRET\",ADMIN_EMAIL=\"$ADMIN_EMAIL\",ADMIN_PASSWORD=\"$ADMIN_PASSWORD\",SERVER_PORT=\"8081\",GOOGLE_CLIENT_ID=\"${GOOGLE_CLIENT_ID:-}\",MAIL_HOST=\"${MAIL_HOST:-}\",MAIL_PORT=\"${MAIL_PORT:-587}\",MAIL_USERNAME=\"${MAIL_USERNAME:-}\",MAIL_PASSWORD=\"${MAIL_PASSWORD:-}\",MAIL_FROM=\"${MAIL_FROM:-}\",APP_BASE_URL=\"${APP_BASE_URL:-https://my-first-sprite-b5urg.sprites.app}\""
prog product "$VENV/uvicorn app.main:app --app-dir $REPO/services/product --host 127.0.0.1 --port 8001" \
  "DATABASE_URL=\"postgresql+psycopg://product_user:${PRODUCT_DB_PASSWORD}@localhost:5432/product_db\",JWT_SECRET=\"$JWT_SECRET\""
prog cart "$VENV/uvicorn app.main:app --app-dir $REPO/services/cart --host 127.0.0.1 --port 8002" \
  "REDIS_URL=\"redis://127.0.0.1:6379/0\",JWT_SECRET=\"$JWT_SECRET\""
prog notification "$VENV/uvicorn app.main:app --app-dir $REPO/services/notification --host 127.0.0.1 --port 8003" \
  "DATABASE_URL=\"postgresql+psycopg://notification_user:${NOTIFICATION_DB_PASSWORD}@localhost:5432/notification_db\",JWT_SECRET=\"$JWT_SECRET\",RABBITMQ_URL=\"amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672/\""
prog inventory "$BIN/inventory" \
  "DATABASE_URL=\"postgres://inventory_user:${INVENTORY_DB_PASSWORD}@127.0.0.1:5432/inventory_db?sslmode=disable\",JWT_SECRET=\"$JWT_SECRET\",INTERNAL_TOKEN=\"$INTERNAL_TOKEN\""
prog payment "$BIN/payment" \
  "DATABASE_URL=\"postgres://payment_user:${PAYMENT_DB_PASSWORD}@127.0.0.1:5432/payment_db?sslmode=disable\",JWT_SECRET=\"$JWT_SECRET\",INTERNAL_TOKEN=\"$INTERNAL_TOKEN\""
prog order "$BIN/order" \
  "DATABASE_URL=\"postgres://order_user:${ORDER_DB_PASSWORD}@127.0.0.1:5432/order_db?sslmode=disable\",JWT_SECRET=\"$JWT_SECRET\",INTERNAL_TOKEN=\"$INTERNAL_TOKEN\",INVENTORY_URL=\"http://127.0.0.1:8082\",PAYMENT_URL=\"http://127.0.0.1:8084\",PRODUCT_URL=\"http://127.0.0.1:8001\",RABBITMQ_URL=\"amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672/\""
prog gateway "node $REPO/services/api-gateway/dist/main.js" \
  "PORT=\"3000\",JWT_SECRET=\"$JWT_SECRET\",IDENTITY_SERVICE_URL=\"http://127.0.0.1:8081\",PRODUCT_SERVICE_URL=\"http://127.0.0.1:8001\",CART_SERVICE_URL=\"http://127.0.0.1:8002\",NOTIFICATION_SERVICE_URL=\"http://127.0.0.1:8003\",INVENTORY_SERVICE_URL=\"http://127.0.0.1:8082\",ORDER_SERVICE_URL=\"http://127.0.0.1:8083\""
{
  echo "[program:backup-daily]"
  echo "command=bash -c \"while true; do $REPO/deploy/sprite/backup.sh; sleep 86400; done\""
  echo "autostart=true"; echo "autorestart=true"
  echo "stdout_logfile=$LOGS/backup.log"; echo "stderr_logfile=$LOGS/backup.log"; echo "redirect_stderr=true"
} > "$SUP/conf.d/backup-daily.conf"
chmod 600 "$SUP/conf.d/backup-daily.conf"

# Kill any pre-supervisor nohup processes from older deploys
for f in "$HOME"/nexus-run/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; done
rm -rf "$HOME/nexus-run"

if supervisorctl -c "$SUP/supervisord.conf" status > /dev/null 2>&1; then
  supervisorctl -c "$SUP/supervisord.conf" reread
  supervisorctl -c "$SUP/supervisord.conf" update
else
  supervisord -c "$SUP/supervisord.conf"
fi
sleep 5
supervisorctl -c "$SUP/supervisord.conf" status || true

echo "== frontend (nginx on 8080, the Sprite URL port) =="
sudo rm -rf /var/www/nexus && sudo cp -r frontend/dist /var/www/nexus && sudo chown -R www-data:www-data /var/www/nexus
sudo tee /etc/nginx/sites-available/nexus > /dev/null <<NGINX
server {
    listen 8080;
    server_name _;
    root /var/www/nexus;
    index index.html;
    gzip on; gzip_types text/css application/javascript application/json image/svg+xml;
    location /assets/ { expires 30d; add_header Cache-Control "public, immutable"; }
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Correlation-Id \$http_x_correlation_id;
    }
    location / { try_files \$uri \$uri/ /index.html; }
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header Referrer-Policy no-referrer;
}
NGINX
sudo ln -sf /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/nexus
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && (sudo nginx 2>/dev/null || sudo nginx -s reload)

echo "== health =="
wait_http http://127.0.0.1:8081/health identity
wait_http http://127.0.0.1:8001/health product
wait_http http://127.0.0.1:8002/health cart
wait_http http://127.0.0.1:8003/health notification
wait_http http://127.0.0.1:8082/health inventory
wait_http http://127.0.0.1:8084/health payment
wait_http http://127.0.0.1:8083/health order
wait_http http://127.0.0.1:3000/health gateway
wait_http http://127.0.0.1:8080/ frontend
curl -s http://127.0.0.1:3000/api/products | head -c 200; echo
echo "DEPLOY DONE — supervised by supervisord, logs in $LOGS"
