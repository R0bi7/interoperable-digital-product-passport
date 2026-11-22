#!/usr/bin/env bash
# One read-only verification run under scripts/live.sh --command bash scripts/eval3-verify.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm exec hardhat lz:oapp:wire --oapp-config layerzero.config.ts --assert --ci
pnpm exec hardhat lz:oapp:config:get --oapp-config layerzero.config.ts
pnpm exec hardhat lz:precheck
node scripts/eval3-deployment-readback.js
