#!/bin/bash
# Seed a realistic demo catalogue + orders against a running stack.
# Idempotent: existing slugs are skipped (409), stock is set absolutely,
# demo orders are created once per run by a fresh demo customer per product batch.
# Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... BASE_URL=http://localhost:3000/api bash scripts/seed-demo.sh
set -u
B=${BASE_URL:-http://localhost:3000/api}
jqget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1"; }

ADMIN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"${ADMIN_EMAIL:-admin@nexus.local}\",\"password\":\"${ADMIN_PASSWORD:-Admin123!}\"}" | jqget "d['accessToken']")
[ -n "$ADMIN" ] && [ "$ADMIN" != "None" ] || { echo "admin login failed"; exit 1; }

# name|slug|category|price|stock|image-seed
PRODUCTS=(
"Wireless Noise-Cancelling Headphones|wireless-headphones|Electronics|79.99|25|nexus-audio"
"Mechanical Keyboard 75%|mechanical-keyboard|Electronics|119.00|18|nexus-keys"
"USB-C Fast Charger 65W|usb-c-charger-65w|Electronics|29.99|60|nexus-charger"
"4K USB Webcam|4k-webcam|Electronics|59.50|14|nexus-cam"
"Ergonomic Office Chair|ergonomic-chair|Home|189.00|8|nexus-chair"
"Ceramic Mug Set of 4|ceramic-mug-set|Home|34.50|40|nexus-mugs"
"Soy Candle — Cedar & Fig|soy-candle-cedar|Home|18.00|50|nexus-candle"
"Walnut Desk Organizer|walnut-desk-organizer|Home|42.00|22|nexus-desk"
"Cotton Crew T-Shirt|cotton-crew-tee|Fashion|24.00|80|nexus-tee"
"Merino Wool Scarf|merino-scarf|Fashion|39.00|35|nexus-scarf"
"Canvas Tote Bag|canvas-tote|Fashion|27.50|45|nexus-tote"
"Trail Running Shoes|trail-running-shoes|Sports|89.99|16|nexus-shoes"
"Insulated Steel Bottle 750ml|steel-bottle|Sports|22.99|70|nexus-bottle"
"Yoga Mat Pro 6mm|yoga-mat-pro|Sports|49.00|28|nexus-yoga"
"Vitamin C Face Serum|vitamin-c-serum|Beauty|31.00|33|nexus-serum"
"Clay Mask Duo|clay-mask-duo|Beauty|19.50|26|nexus-mask"
"Linen Bedding Set|linen-bedding-set|Home|99.00|10|nexus-bedding"
"Pour-Over Coffee Set|pour-over-coffee|Home|64.00|15|nexus-coffee"
"Bluetooth Speaker Mini|bluetooth-speaker-mini|Electronics|45.99|30|nexus-speaker"
"Leather Card Wallet|leather-wallet|Fashion|54.00|20|nexus-wallet"
)

declare -A CATIDS
for row in "${PRODUCTS[@]}"; do
  IFS='|' read -r name slug cat price stock seed <<< "$row"
  if [ -z "${CATIDS[$cat]:-}" ]; then
    resp=$(curl -s -X POST $B/categories -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"name\":\"$cat\"}")
    cid=$(echo "$resp" | jqget "d.get('id','')" 2>/dev/null || echo "")
    if [ -z "$cid" ] || [ "$cid" = "None" ]; then
      cid=$(curl -s $B/categories | python3 -c "import sys,json;print(next((c['id'] for c in json.load(sys.stdin) if c['name']=='$cat'),''))")
    fi
    CATIDS[$cat]=$cid
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/products -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"slug\":\"$slug\",\"description\":\"$name — quality everyday goods from Nexus.\",\"price\":$price,\"image_url\":\"https://picsum.photos/seed/$seed/600/400\",\"category_id\":\"${CATIDS[$cat]}\"}")
  pid=$(curl -s "$B/products?q=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$name'))")" | python3 -c "import sys,json; rows=json.load(sys.stdin); print(next((p['id'] for p in rows if p['slug']=='$slug'),''))" 2>/dev/null)
  [ -n "$pid" ] && curl -s -X PUT $B/inventory/$pid -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "{\"quantity\":$stock}" > /dev/null
  echo "seeded [$code] $name (stock $stock)"
done

echo "== demo orders for admin reports =="
BUYER="demo-buyer@test.local"
curl -s -X POST $B/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$BUYER\",\"password\":\"secret123\",\"fullName\":\"Demo Buyer\"}" > /dev/null
BT=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$BUYER\",\"password\":\"secret123\"}" | jqget "d['accessToken']")
PIDS=$(curl -s "$B/products?size=30" | python3 -c "import sys,json;print(' '.join(p['id'] for p in json.load(sys.stdin)[:6]))")
i=0
for pid in $PIDS; do
  i=$((i+1))
  oid=$(curl -s -X POST $B/orders -H "Authorization: Bearer $BT" -H 'Content-Type: application/json' -H "Idempotency-Key: seed-order-$pid" \
    -d "{\"items\":[{\"productId\":\"$pid\",\"productName\":\"seed\",\"unitPrice\":1,\"quantity\":1}],\"paymentToken\":\"tok_success\"}" | jqget "d.get('id','')" 2>/dev/null)
  [ -z "$oid" ] || [ "$oid" = "None" ] && continue
  case $((i % 3)) in
    0) curl -s -X PUT $B/admin/orders/$oid/status -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"status":"PROCESSING"}' > /dev/null
       curl -s -X PUT $B/admin/orders/$oid/status -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"status":"SHIPPED"}' > /dev/null
       curl -s -X PUT $B/admin/orders/$oid/status -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"status":"DELIVERED"}' > /dev/null;;
    1) curl -s -X PUT $B/admin/orders/$oid/status -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"status":"PROCESSING"}' > /dev/null;;
    2) : ;;
  esac
  echo "demo order $oid seeded"
done
echo "SEED DONE"
