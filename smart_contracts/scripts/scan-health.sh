#!/usr/bin/env bash
set -euo pipefail
sample_dir=$(mktemp -d)
trap 'rm -rf "$sample_dir"' EXIT
for eid in 40161 40231 40245; do
  curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
    "https://scan-testnet.layerzero-api.com/v1/messages/latest?srcChainIds=${eid}&limit=25" > "$sample_dir/$eid.json"
done
python3 - "$sample_dir" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path
now = datetime.now(timezone.utc)
failed = False
for eid, name in [(40161, 'sepolia'), (40231, 'arbitrum-sepolia'), (40245, 'base-sepolia')]:
    sample = json.loads((Path(sys.argv[1]) / f'{eid}.json').read_text()).get('data', [])
    messages = [m for m in sample if m.get('pathway', {}).get('srcEid') == eid and m.get('pathway', {}).get('dstEid') in (40161, 40231, 40245) and m['pathway']['dstEid'] != eid]
    if not messages:
        print(f'Scan unhealthy: {name} has no sampled message to another eval3 chain'); failed = True; continue
    latest = max(messages, key=lambda m: m.get('created', ''))
    created = datetime.fromisoformat(latest['created'].replace('Z', '+00:00'))
    age = (now - created).total_seconds()
    status = latest.get('status', {}).get('name', 'unknown')
    healthy = 0 <= age < 3600 and status in ('DELIVERED', 'INFLIGHT')
    print(f'Scan {"healthy" if healthy else "unhealthy"}: {name} eid={eid} dstEid={latest["pathway"]["dstEid"]} age={age:.0f}s status={status} at={now.isoformat()}')
    failed |= not healthy
sys.exit(1 if failed else 0)
PY
