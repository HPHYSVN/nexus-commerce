#!/bin/bash
# Nexus Commerce E2E smoke: register->login->admin stock->cart->order success/fail->notification
set -u
B=${BASE_URL:-http://localhost:3000/api}
JQ() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }
fail() { echo "FAIL: $1"; exit 1; }

EMAIL="e2e-$RANDOM@test.local"
echo "== register $EMAIL =="
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"fullName\":\"E2E User\"}" | head -c 200; echo
LOGIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\"}")
TOKEN=$(echo "$LOGIN" | JQ "d['accessToken']") || fail "login"
[ -n "$TOKEN" ] || fail "no token"
AUTH="-H Authorization:Bearer\ $TOKEN"
echo "== me =="
curl -s $B/auth/me -H "Authorization: Bearer $TOKEN"; echo

ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"'"${ADMIN_EMAIL:-admin@nexus.local}"'","password":"'"${ADMIN_PASSWORD:-Admin123!}"'"}' | JQ "d['accessToken']")
echo "== products =="
PROD=$(curl -s "$B/products")
PID=$(echo "$PROD" | JQ "d[0]['id']")
PNAME=$(echo "$PROD" | JQ "d[0]['name']")
PRICE=$(echo "$PROD" | JQ "d[0]['price']")
echo "product: $PID $PNAME $PRICE"
curl -s "$B/categories"; echo

echo "== admin sets stock 10 =="
curl -s -X PUT $B/inventory/$PID -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"quantity":10}'; echo
echo "== customer cannot set stock (expect 403) =="
curl -s -o /dev/null -w '%{http_code}\n' -X PUT $B/inventory/$PID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"quantity":99}'

echo "== cart add 2 =="
curl -s -X POST $B/cart/items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"productId\":\"$PID\",\"productName\":\"$PNAME\",\"unitPrice\":$PRICE,\"quantity\":2}"; echo

echo "== checkout success =="
ORDER=$(curl -s -X POST $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$PID\",\"productName\":\"$PNAME\",\"unitPrice\":$PRICE,\"quantity\":2}],\"paymentToken\":\"tok_success\"}")
echo "$ORDER"
STATUS=$(echo "$ORDER" | JQ "d['status']")
[ "$STATUS" = "CONFIRMED" ] || fail "expected CONFIRMED got $STATUS"
echo "== stock after success (expect quantity 8) =="
curl -s $B/inventory/$PID -H "Authorization: Bearer $TOKEN"; echo

echo "== checkout payment failure (stock must stay 8) =="
ORDER2=$(curl -s -X POST $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$PID\",\"productName\":\"$PNAME\",\"unitPrice\":$PRICE,\"quantity\":1}],\"paymentToken\":\"tok_fail\"}")
echo "$ORDER2"
STATUS2=$(echo "$ORDER2" | JQ "d['status']")
[ "$STATUS2" = "PAYMENT_FAILED" ] || fail "expected PAYMENT_FAILED got $STATUS2"
curl -s $B/inventory/$PID -H "Authorization: Bearer $TOKEN"; echo

echo "== orders list =="
curl -s $B/orders -H "Authorization: Bearer $TOKEN" | head -c 300; echo
echo "== refresh token rotation =="
REFRESH=$(echo "$LOGIN" | JQ "d['refreshToken']")
curl -s -X POST $B/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" | head -c 120; echo
echo "== old refresh reuse must fail =="
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"

sleep 3
echo "== notifications (admin sees all) =="
curl -s "$B/notifications?limit=10" -H "Authorization: Bearer $ADMIN"; echo
echo "E2E DONE"
