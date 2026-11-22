#!/usr/bin/env bash
# Probes the browser's default RPC of each eval3 chain (viem's `http()` default for the chain) with plain
# eth_blockNumber requests and prints one line per request: UTC time, chain, HTTP status, seconds.
#   bash docs/acceptance/automation/eval3/rpc-probe.sh [requests per chain, default 5] >> <evidence file>
N=${1:-5}
probe() {
  local name=$1 url=$2 i
  for i in $(seq 1 "$N"); do
    printf '%s %s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name"
    curl -s -m 10 -o /dev/null -w '%{http_code} %{time_total}\n' -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$url" || echo "error"
    sleep 2
  done
}
probe sepolia https://11155111.rpc.thirdweb.com
probe arbitrum-sepolia https://sepolia-rollup.arbitrum.io/rpc
probe base-sepolia https://sepolia.base.org
