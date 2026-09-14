#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# This Git-ignored dependency layout matches Cargo, Bun and generated native paths.
RUSTRA_SOURCE=.deps/rustra-main
RUSTRA_REV=87f5f1f3e27e8d310bcf02998d5fe80f0e11f636
if [ ! -d "$RUSTRA_SOURCE/.git" ]; then
 mkdir -p .deps
 git clone https://github.com/loopy-lim/rustra.git "$RUSTRA_SOURCE"
 git -C "$RUSTRA_SOURCE" checkout --detach "$RUSTRA_REV"
fi
if [ "$(git -C "$RUSTRA_SOURCE" rev-parse HEAD)" != "$RUSTRA_REV" ]; then
 echo "Expected Rustra $RUSTRA_REV at $RUSTRA_SOURCE; refusing to alter an existing checkout." >&2
 exit 1
fi
bun install --cwd "$RUSTRA_SOURCE" --frozen-lockfile
bun run --cwd "$RUSTRA_SOURCE/packages/types" build
bun run --cwd "$RUSTRA_SOURCE/packages/react-native" build
bun install --frozen-lockfile
bun run codegen
bun run codegen --check
