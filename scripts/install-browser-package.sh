#!/usr/bin/env bash
set -euo pipefail

framework_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:?usage: install-browser-package.sh TARGET [copy|link]}"
mode="${2:-copy}"
target="$(mkdir -p "${target}" && cd "${target}" && pwd)"

case "${mode}" in
  copy)
    install -m 0644 "${framework_dir}/dist/index.html" "${target}/index.html"
    install -m 0644 "${framework_dir}/dist/wolfwasm-shell.js" "${target}/wolfwasm-shell.js"
    install -m 0644 "${framework_dir}/dist/wolfwasm-shell.css" "${target}/wolfwasm-shell.css"
    install -m 0644 "${framework_dir}/dist/wolfwasm-bootstrap.js" "${target}/wolfwasm-bootstrap.js"
    ;;
  link)
    ln -sfn "${framework_dir}/dist/index.html" "${target}/index.html"
    ln -sfn "${framework_dir}/dist/wolfwasm-shell.js" "${target}/wolfwasm-shell.js"
    ln -sfn "${framework_dir}/dist/wolfwasm-shell.css" "${target}/wolfwasm-shell.css"
    ln -sfn "${framework_dir}/dist/wolfwasm-bootstrap.js" "${target}/wolfwasm-bootstrap.js"
    ;;
  *)
    echo "mode must be copy or link" >&2
    exit 64
    ;;
esac

version="$(node -p "require('${framework_dir}/package.json').version")"
sha_js="$(sha256sum "${framework_dir}/dist/wolfwasm-shell.js" | cut -d' ' -f1)"
sha_css="$(sha256sum "${framework_dir}/dist/wolfwasm-shell.css" | cut -d' ' -f1)"
sha_bootstrap="$(sha256sum "${framework_dir}/dist/wolfwasm-bootstrap.js" | cut -d' ' -f1)"
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

echo "installed wasm-framework ${version} (${mode}) into ${target}"
