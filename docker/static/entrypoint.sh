#!/bin/sh
set -eu

variant="${WASM_GAME_VARIANT:-suite}"
case "${variant}" in
  *[!a-zA-Z0-9_-]*)
    echo "Invalid WASM_GAME_VARIANT: ${variant}" >&2
    exit 64
    ;;
esac

echo "wasm-game-framework ${WASM_GAME_FRAMEWORK_VERSION:-legacy}: serving variant=${variant} on tcp/8088"
exec node /opt/wasm-game-framework/server/static-server.js
