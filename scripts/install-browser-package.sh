#!/usr/bin/env bash
set -euo pipefail

framework_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:?usage: install-browser-package.sh TARGET [copy|link]}"
mode="${2:-copy}"
target="$(mkdir -p "${target}" && cd "${target}" && pwd)"

# Remove pre-0.7 public filenames so a copied upgrade cannot silently keep
# serving the former WolfET-specific API beside the generic package.
rm -f -- \
  "${target}/wolfwasm-shell.js" \
  "${target}/wolfwasm-shell.css" \
  "${target}/wolfwasm-bootstrap.js"

case "${mode}" in
  copy)
    install -m 0644 "${framework_dir}/dist/index.html" "${target}/index.html"
    install -m 0644 "${framework_dir}/dist/wasm-game-framework.js" "${target}/wasm-game-framework.js"
    install -m 0644 "${framework_dir}/dist/wasm-game-framework.css" "${target}/wasm-game-framework.css"
    install -m 0644 "${framework_dir}/dist/wasm-game-bootstrap.js" "${target}/wasm-game-bootstrap.js"
    ;;
  link)
    ln -sfn "${framework_dir}/dist/index.html" "${target}/index.html"
    ln -sfn "${framework_dir}/dist/wasm-game-framework.js" "${target}/wasm-game-framework.js"
    ln -sfn "${framework_dir}/dist/wasm-game-framework.css" "${target}/wasm-game-framework.css"
    ln -sfn "${framework_dir}/dist/wasm-game-bootstrap.js" "${target}/wasm-game-bootstrap.js"
    ;;
  *)
    echo "mode must be copy or link" >&2
    exit 64
    ;;
esac

version="$(node -p "require('${framework_dir}/package.json').version")"
sha_js="$(sha256sum "${framework_dir}/dist/wasm-game-framework.js" | cut -d' ' -f1)"
sha_css="$(sha256sum "${framework_dir}/dist/wasm-game-framework.css" | cut -d' ' -f1)"
sha_bootstrap="$(sha256sum "${framework_dir}/dist/wasm-game-bootstrap.js" | cut -d' ' -f1)"
sha_document="$(sha256sum "${framework_dir}/dist/index.html" | cut -d' ' -f1)"
printf '%s\n' \
  "{" \
  "  \"package\": \"@wasm-game-framework/browser\"," \
  "  \"version\": \"${version}\"," \
  "  \"javascriptSha256\": \"${sha_js}\"," \
  "  \"stylesheetSha256\": \"${sha_css}\"," \
  "  \"bootstrapSha256\": \"${sha_bootstrap}\"," \
  "  \"documentSha256\": \"${sha_document}\"" \
  "}" > "${target}/wasm-game-framework.json"

echo "installed wasm-game-framework ${version} (${mode}) into ${target}"
