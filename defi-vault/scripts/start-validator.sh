#!/usr/bin/env bash
# Локальный валидатор с настоящей программой Raydium CLMM и AmmConfig, склонированными из devnet.
# После запуска: anchor test --skip-local-validator
set -euo pipefail

CLMM=DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH
AMM_CONFIG=FZdkW5jiYsjTnCVqFqPrxrQisQkCYrohd7ArZhoKnM8q

exec solana-test-validator --reset --quiet --ledger "${LEDGER:-/tmp/vault-ledger}" \
  --url https://api.devnet.solana.com \
  --clone-upgradeable-program "$CLMM" \
  --clone "$AMM_CONFIG"
