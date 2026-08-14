#!/usr/bin/env bash
set -euo pipefail

framework_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('${framework_dir}/package.json').version")"
image="${1:-wasm-game-framework:${version}}"
context_dir="$(mktemp -d -t wasm-framework-base.XXXXXX)"
trap 'rm -rf -- "${context_dir}"' EXIT

mkdir -p "${context_dir}/framework-dist" "${context_dir}/framework-server"
cp -a "${framework_dir}/dist/." "${context_dir}/framework-dist/"
cp "${framework_dir}/server/provisioning.js" "${framework_dir}/server/static-server.js" "${context_dir}/framework-server/"
cp "${framework_dir}/package.json" "${context_dir}/package.json"
cp "${framework_dir}/docker/base/Dockerfile" "${context_dir}/Dockerfile"
cp "${framework_dir}/docker/static/entrypoint.sh" "${context_dir}/entrypoint.sh"

docker build \
  --build-arg "FRAMEWORK_VERSION=${version}" \
  --tag "${image}" \
  "${context_dir}"

installed_version="$(docker run --rm --entrypoint node "${image}" -p \
  "require('/opt/wasm-game-framework/package.json').version")"
if [[ "$installed_version" != "$version" ]]; then
  printf 'Framework image version mismatch: expected %s, found %s\n' "$version" "$installed_version" >&2
  exit 1
fi

echo "built ${image}"
