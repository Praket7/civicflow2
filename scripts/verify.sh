#!/usr/bin/env bash
set -euo pipefail

pnpm typecheck
pnpm lint
pnpm format
pnpm check:copy
pnpm check:i18n
pnpm check:hardcodes
pnpm check:generated
pnpm docs:check
pnpm test
pnpm test:sql
pnpm build:web

# These need headless Chrome. --best-effort skips only when no browser is
# installed; a real failure still exits non-zero.
echo "print audit"
node scripts/audit-print.mjs --best-effort
echo "accessibility tree audit"
node scripts/audit-accessibility-tree.mjs --best-effort
echo "200% zoom audit"
node scripts/audit-zoom.mjs --best-effort
echo "contrast audit"
node scripts/audit-contrast.mjs --best-effort

pushd src-tauri/core >/dev/null
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
popd >/dev/null
