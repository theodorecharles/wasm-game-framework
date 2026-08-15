#!/bin/sh
set -eu

variant="${WASM_GAME_VARIANT:-suite}"
case "${variant}" in
  *[!a-zA-Z0-9_-]*)
    echo "Invalid WASM_GAME_VARIANT: ${variant}" >&2
    exit 64
    ;;
esac

if [ -n "${WASM_GAME_PASSWORD:-}" ] && [ -z "${WASM_GAME_SESSION_SECRET:-}" ]; then
  WASM_GAME_SESSION_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")"
  export WASM_GAME_SESSION_SECRET
fi

echo "wasm-game-framework ${WASM_GAME_FRAMEWORK_VERSION:-legacy}: serving variant=${variant} on tcp/8088"
exec node /opt/wasm-game-framework/server/static-server.js
