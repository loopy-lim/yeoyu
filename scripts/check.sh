#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo fmt --manifest-path native/Cargo.toml -- --check
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
bun test tests
python3 scripts/check-split-geometry.py
python3 -m unittest discover -s tests -p 'test_*.py'
bun scripts/contrast-check.ts
bun run typecheck
bun run codegen --check
