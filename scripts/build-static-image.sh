#!/usr/bin/env bash
set -euo pipefail

framework_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_root="${1:?usage: build-static-image.sh SITE_ROOT IMAGE [VARIANT]}"
image="${2:?usage: build-static-image.sh SITE_ROOT IMAGE [VARIANT]}"
variant="${3:-suite}"
version="$(node -p "require('${framework_dir}/package.json').version")"
if [[ -n "${WASM_GAME_FRAMEWORK_IMAGE:-}" ]]; then
  framework_image="${WASM_GAME_FRAMEWORK_IMAGE}"
else
  framework_image="wasm-game-framework:${version}"
  "${framework_dir}/scripts/build-base-image.sh" "${framework_image}"
fi

site_root="$(realpath "${site_root}")"
context_dir="$(mktemp -d -t wasm-game-image.XXXXXX)"
trap 'rm -rf -- "${context_dir}"' EXIT
mkdir -p "${context_dir}/game-site"
cp -a "${site_root}/." "${context_dir}/game-site/"
cp "${framework_dir}/docker/game/Dockerfile" "${context_dir}/Dockerfile"

docker build \
  --build-arg "FRAMEWORK_IMAGE=${framework_image}" \
  --build-arg "GAME_VARIANT=${variant}" \
  --tag "${image}" \
  "${context_dir}"
