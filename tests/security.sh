#!/bin/bash
# Security checks against a running stack. Expects ADMIN_EMAIL/ADMIN_PASSWORD env (defaults match .env.example).
set -u
B=http://localhost:3000/api
PASS=0; FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS: $1 ($3)"; PASS=$((PASS+1)); else echo "FAIL: $1 expected=$2 got=$3"; FAIL=$((FAIL+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# 1. Protected route without token -> 401
check "no token -> 401" 401 "$(code $B/cart)"
check "no token orders -> 401" 401 "$(code $B/orders)"

# 2. Forged JWT (valid structure, wrong secret) -> 401
FORGED=$(python3 - <<'PY'
import base64, hashlib, hmac, json, time
def b(x): return base64.urlsafe_b64encode(x).rstrip(b'=').decode()
h = b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); now = int(time.time())
p = b(json.dumps({"sub":"attacker","role":"ADMIN","iat":now,"exp":now+900}).encode())
sig = b(hmac.new(b"wrong-secret-wrong-secret-123456", f"{h}.{p}".encode(), hashlib.sha256).digest())
print(f"{h}.{p}.{sig}")
PY
)
check "forged ADMIN jwt -> 401" 401 "$(code $B/cart -H "Authorization: Bearer $FORGED")"
check "forged jwt admin write -> 401" 401 "$(code -X PUT $B/inventory/some-id -H "Authorization: Bearer $FORGED" -H 'Content-Type: application/json' -d '{"quantity":1}')"

# 3. Customer cannot do admin writes -> 403
EMAIL="sec-$RANDOM@test.local"
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"fullName\":\"Sec\"}" > /dev/null
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
PID=$(curl -s "$B/products" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
check "customer set stock -> 403" 403 "$(code -X PUT $B/inventory/$PID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"quantity":5}')"
check "customer create product -> 403" 403 "$(code -X POST $B/products -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Hack","price":1}')"

# 4. IDOR: user B cannot read user A's order (create one as A first via admin stock + checkout)
ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"${ADMIN_EMAIL:-admin@nexus.local}\",\"password\":\"${ADMIN_PASSWORD:-Admin123!}\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
curl -s -X PUT $B/inventory/$PID -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"quantity":3}' > /dev/null
OID=$(curl -s -X POST $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$PID\",\"productName\":\"X\",\"unitPrice\":1,\"quantity\":1}],\"paymentToken\":\"tok_success\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
EMAIL2="sec2-$RANDOM@test.local"
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL2\",\"password\":\"secret123\",\"fullName\":\"Sec2\"}" > /dev/null
TOKEN2=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL2\",\"password\":\"secret123\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
check "other user reads order -> 403" 403 "$(code $B/orders/$OID -H "Authorization: Bearer $TOKEN2")"
check "owner reads order -> 200" 200 "$(code $B/orders/$OID -H "Authorization: Bearer $TOKEN")"

# 5. SQL injection attempt on search: must be 200 and must NOT dump all products
N_ALL=$(curl -s "$B/products" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
N_SQLI=$(curl -s "$B/products?q=%27%20OR%20%271%27%3D%271" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo err)
if [ "$N_SQLI" != "err" ] && [ "$N_SQLI" -lt "$N_ALL" ]; then echo "PASS: SQLi search safe (returned $N_SQLI of $N_ALL)"; PASS=$((PASS+1)); else echo "FAIL: SQLi search returned $N_SQLI of $N_ALL"; FAIL=$((FAIL+1)); fi

# 6. Security headers from gateway
H=$(curl -sI $B/products | tr -d '\r')
for hdr in "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: no-referrer" "x-correlation-id:"; do
  if echo "$H" | grep -qi "^$hdr"; then echo "PASS: header $hdr"; PASS=$((PASS+1)); else echo "FAIL: missing header $hdr"; FAIL=$((FAIL+1)); fi
done

# 7. Wrong password -> 401 (run before the rate-limit hammer below)
check "wrong password -> 401" 401 "$(code -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"definitely-wrong\"}")"

# 8. Rate limiting on /api/auth: hammer login, expect at least one 429 (must run last)
got429=0
for i in $(seq 1 40); do
  c=$(code -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"email":"nobody@test.local","password":"wrong-pass"}')
  [ "$c" = "429" ] && { got429=1; break; }
done
check "auth rate limit -> 429" 1 "$got429"

echo "SECURITY: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
