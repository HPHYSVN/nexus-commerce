#!/bin/bash
# Flash-sale test: stock=10, 40 simultaneous buy attempts of qty 1.
# Exactly 10 may confirm; the rest must be 409; stock must end at 0/0.
set -u
B=${BASE_URL:-http://localhost:3000/api}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"${ADMIN_EMAIL:-admin@nexus.local}\",\"password\":\"${ADMIN_PASSWORD:-Admin123!}\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
PID=$(curl -s "$B/products" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
EMAIL="flash-$RANDOM@test.local"
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"fullName\":\"Flash\"}" > /dev/null
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s -X PUT $B/inventory/$PID -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"quantity":10}' > /dev/null
echo "stock=10, firing 40 simultaneous purchases..."
for i in $(seq 1 40); do
  ( code=$(curl -s -o "$TMP/$i.json" -w '%{http_code}' -X POST $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: flash-$i-$RANDOM" \
      -d "{\"items\":[{\"productId\":\"$PID\",\"productName\":\"Flash\",\"unitPrice\":1,\"quantity\":1}],\"shipping\":{\"recipientName\":\"Test Buyer\",\"phone\":\"0900000000\",\"addressLine\":\"1 Test Street\",\"city\":\"Hanoi\",\"method\":\"STANDARD\"},\"paymentToken\":\"tok_success\"}")
    echo "$code" > "$TMP/$i.code" ) &
done
wait
ok=0; conflict=0
for i in $(seq 1 40); do
  case "$(cat "$TMP/$i.code")" in
    201) grep -q '"status":"CONFIRMED"' "$TMP/$i.json" && ok=$((ok+1));;
    409) conflict=$((conflict+1));;
  esac
done
STOCK=$(curl -s $B/inventory/$PID -H "Authorization: Bearer $TOKEN")
echo "confirmed=$ok conflicts=$conflict stock=$STOCK"
if [ "$ok" -eq 10 ] && [ "$conflict" -eq 30 ] && echo "$STOCK" | grep -q '"quantity":0,"reserved":0'; then
  echo "FLASH-SALE TEST PASSED: exactly stock sold, no oversell"
else
  echo "FLASH-SALE TEST FAILED"; exit 1
fi
