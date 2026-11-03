#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# This Git-ignored dependency layout matches Cargo, Bun and generated native paths.
RUSTRA_SOURCE=.deps/rustra-main
RUSTRA_REV=d5d3ba87cf5b04ec9de00be61141d153113c3c92
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
