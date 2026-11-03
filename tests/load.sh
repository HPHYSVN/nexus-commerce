#!/bin/bash
# Burst/traffic test: 300 product-list requests, 20-way parallel.
# Pass criteria: >=99% HTTP 200 and p95 latency < 1500ms (generous for free-tier VM).
set -u
B=${BASE_URL:-http://localhost:3000/api}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
TOTAL=${LOAD_TOTAL:-300}; PAR=${LOAD_PARALLEL:-20}
echo "firing $TOTAL requests (${PAR}x parallel) at $B/products ..."
seq 1 "$TOTAL" | xargs -P "$PAR" -I{} sh -c 'curl -s -o /dev/null -w "%{http_code} %{time_total}\n" "'$B'/products" >> "'$TMP'/results.txt"'
python3 - "$TMP/results.txt" <<'PY'
import sys
rows = [l.split() for l in open(sys.argv[1]) if l.strip()]
codes = [r[0] for r in rows]; times = sorted(float(r[1]) for r in rows)
ok = sum(1 for c in codes if c == "200")
p50 = times[len(times)//2]; p95 = times[int(len(times)*0.95)]
print(f"requests={len(rows)} ok200={ok} ({ok/len(rows)*100:.1f}%) p50={p50*1000:.0f}ms p95={p95*1000:.0f}ms max={times[-1]*1000:.0f}ms")
errors = {c: codes.count(c) for c in set(codes) if c != "200"}
if errors: print("non-200:", errors)
sys.exit(0 if ok/len(rows) >= 0.99 and p95 < 1.5 else 1)
PY
[ $? -eq 0 ] && echo "LOAD TEST PASSED" || { echo "LOAD TEST FAILED"; exit 1; }
