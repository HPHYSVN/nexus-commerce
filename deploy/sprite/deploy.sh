#!/bin/bash
# Nexus Commerce — native deployment inside a Fly.io Sprite.
# Docker-in-Sprite is unreliable (the sandbox blocks setns/netns bind mounts),
# so services run natively with the Sprite's preinstalled runtimes.
# Prereqs: repo cloned at ~/nexus-commerce, strong secrets in .env, and
#   sudo apt-get install -y postgresql redis-server rabbitmq-server nginx maven
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
RUN=$HOME/nexus-run; LOGS=$HOME/nexus-logs; BIN=$HOME/nexus-bin
mkdir -p "$RUN" "$LOGS" "$BIN"
set -a; source .env; set +a
: "${INTERNAL_TOKEN:?INTERNAL_TOKEN must be set in .env (service-to-service auth)}"

start() { # name cmd...
  local name=$1; shift
  if [ -f "$RUN/$name.pid" ] && kill -0 "$(cat "$RUN/$name.pid")" 2>/dev/null; then
    echo "$name already running"; return
  fi
  nohup "$@" > "$LOGS/$name.log" 2>&1 &
  echo $! > "$RUN/$name.pid"
  echo "started $name (pid $!)"
}
wait_http() { # url name
  for i in $(seq 1 40); do curl -sf "$1" > /dev/null 2>&1 && { echo "$2 up"; return; }; sleep 2; done
  echo "WARN: $2 not responding at $1 — see $LOGS"; 
}

echo "== infrastructure =="
sudo service postgresql start || true
# Create per-service DBs/users via stdin (the postgres OS user cannot read $HOME).
mkdb() { # user password db
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

echo "== builds =="
[ -f services/identity/target/identity-0.1.0.jar ] || (cd services/identity && mvn -q -DskipTests package)
for s in inventory payment order; do
  [ -f "$BIN/$s" ] || (cd "services/$s" && go build -o "$BIN/$s" .)
done
[ -d "$HOME/nexus-venv" ] || python3 -m venv "$HOME/nexus-venv"
"$HOME/nexus-venv/bin/pip" install -q -r services/product/requirements.txt -r services/cart/requirements.txt -r services/notification/requirements.txt
(cd services/api-gateway && npm ci --silent && npm run build --silent)
(cd frontend && npm ci --silent && VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID:-} npm run build --silent)

echo "== services =="
export JWT_SECRET
stop_one() { [ -f "$RUN/$1.pid" ] && kill "$(cat "$RUN/$1.pid")" 2>/dev/null || true; }
for n in identity product cart notification inventory payment order gateway; do stop_one $n; done
sleep 1
DB_HOST=localhost DB_PORT=5432 DB_NAME=identity_db DB_USER=identity_user DB_PASSWORD=$IDENTITY_DB_PASSWORD \
  ADMIN_EMAIL=$ADMIN_EMAIL ADMIN_PASSWORD=$ADMIN_PASSWORD SERVER_PORT=8081 \
  GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-} MAIL_HOST=${MAIL_HOST:-} MAIL_PORT=${MAIL_PORT:-587} MAIL_USERNAME=${MAIL_USERNAME:-} MAIL_PASSWORD=${MAIL_PASSWORD:-} MAIL_FROM=${MAIL_FROM:-} APP_BASE_URL=${APP_BASE_URL:-https://my-first-sprite-b5urg.sprites.app} \
  nohup java -jar services/identity/target/identity-0.1.0.jar > "$LOGS/identity.log" 2>&1 &
echo $! > "$RUN/identity.pid"

DATABASE_URL="postgresql+psycopg://product_user:${PRODUCT_DB_PASSWORD}@localhost:5432/product_db" \
  nohup "$HOME/nexus-venv/bin/uvicorn" app.main:app --app-dir services/product --host 127.0.0.1 --port 8001 > "$LOGS/product.log" 2>&1 &
echo $! > "$RUN/product.pid"

REDIS_URL=redis://127.0.0.1:6379/0 \
  nohup "$HOME/nexus-venv/bin/uvicorn" app.main:app --app-dir services/cart --host 127.0.0.1 --port 8002 > "$LOGS/cart.log" 2>&1 &
echo $! > "$RUN/cart.pid"

DATABASE_URL="postgresql+psycopg://notification_user:${NOTIFICATION_DB_PASSWORD}@localhost:5432/notification_db" \
  RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672/" \
  nohup "$HOME/nexus-venv/bin/uvicorn" app.main:app --app-dir services/notification --host 127.0.0.1 --port 8003 > "$LOGS/notification.log" 2>&1 &
echo $! > "$RUN/notification.pid"

DATABASE_URL="postgres://inventory_user:${INVENTORY_DB_PASSWORD}@127.0.0.1:5432/inventory_db?sslmode=disable" INTERNAL_TOKEN=$INTERNAL_TOKEN \
  nohup "$BIN/inventory" > "$LOGS/inventory.log" 2>&1 &
echo $! > "$RUN/inventory.pid"

DATABASE_URL="postgres://payment_user:${PAYMENT_DB_PASSWORD}@127.0.0.1:5432/payment_db?sslmode=disable" INTERNAL_TOKEN=$INTERNAL_TOKEN \
  nohup "$BIN/payment" > "$LOGS/payment.log" 2>&1 &
echo $! > "$RUN/payment.pid"

DATABASE_URL="postgres://order_user:${ORDER_DB_PASSWORD}@127.0.0.1:5432/order_db?sslmode=disable" \
  INVENTORY_URL=http://127.0.0.1:8082 PAYMENT_URL=http://127.0.0.1:8084 PRODUCT_URL=http://127.0.0.1:8001 \
  RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672/" INTERNAL_TOKEN=$INTERNAL_TOKEN \
  nohup "$BIN/order" > "$LOGS/order.log" 2>&1 &
echo $! > "$RUN/order.pid"

PORT=3000 IDENTITY_SERVICE_URL=http://127.0.0.1:8081 PRODUCT_SERVICE_URL=http://127.0.0.1:8001 \
  CART_SERVICE_URL=http://127.0.0.1:8002 NOTIFICATION_SERVICE_URL=http://127.0.0.1:8003 \
  INVENTORY_SERVICE_URL=http://127.0.0.1:8082 ORDER_SERVICE_URL=http://127.0.0.1:8083 \
  CORS_ORIGIN="http://localhost:8080" \
  nohup node services/api-gateway/dist/main.js > "$LOGS/gateway.log" 2>&1 &
echo $! > "$RUN/gateway.pid"

echo "== frontend (nginx on 8080, the Sprite URL port) =="
sudo rm -rf /var/www/nexus && sudo cp -r frontend/dist /var/www/nexus && sudo chown -R www-data:www-data /var/www/nexus
sudo tee /etc/nginx/sites-available/nexus > /dev/null <<NGINX
server {
    listen 8080;
    server_name _;
    root /var/www/nexus;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Correlation-Id \$http_x_correlation_id;
    }
    location / { try_files \$uri \$uri/ /index.html; }
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
echo "DEPLOY DONE — logs in $LOGS"
