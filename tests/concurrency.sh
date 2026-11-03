#!/bin/bash
# Oversell test: stock=5, 10 parallel orders of qty 1 -> exactly 5 CONFIRMED, 5x 409, stock 0/reserved 0.
set -u
B=http://localhost:3000/api
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

EMAIL="conc-$RANDOM@test.local"
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"fullName\":\"Conc\"}" > /dev/null
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"'"${ADMIN_EMAIL:-admin@nexus.local}"'","password":"'"${ADMIN_PASSWORD:-Admin123!}"'"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
PID=$(curl -s "$B/products" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

curl -s -X PUT $B/inventory/$PID -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"quantity":5}' > /dev/null
echo "stock set to 5 for $PID; firing 10 parallel orders..."

for i in $(seq 1 10); do
  ( code=$(curl -s -o "$TMP/$i.json" -w '%{http_code}' -X POST $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -d "{\"items\":[{\"productId\":\"$PID\",\"productName\":\"Conc Item\",\"unitPrice\":1,\"quantity\":1}],\"paymentToken\":\"tok_success\"}")
    echo "$code" > "$TMP/$i.code" ) &
done
wait

ok=0; conflict=0
for i in $(seq 1 10); do
  case "$(cat "$TMP/$i.code")" in
    201) grep -q '"status":"CONFIRMED"' "$TMP/$i.json" && ok=$((ok+1)) ;;
    409) conflict=$((conflict+1)) ;;
  esac
done
STOCK=$(curl -s $B/inventory/$PID -H "Authorization: Bearer $TOKEN")
echo "confirmed=$ok conflicts=$conflict stock=$STOCK"
if [ "$ok" -eq 5 ] && [ "$conflict" -eq 5 ] && echo "$STOCK" | grep -q '"quantity":0,"reserved":0'; then
  echo "CONCURRENCY TEST PASSED: no oversell"
else
  echo "CONCURRENCY TEST FAILED"; exit 1
fi
