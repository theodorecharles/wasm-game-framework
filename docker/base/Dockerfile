FROM node:22-alpine

ARG FRAMEWORK_VERSION=dev

LABEL org.opencontainers.image.title="WASM Game Framework" \
      org.opencontainers.image.description="Shared browser-game shell and container runtime" \
      io.wasm-game-framework.version="${FRAMEWORK_VERSION}"

COPY entrypoint.sh /usr/local/bin/wasm-game-entrypoint
COPY framework-dist/ /opt/shared-shell/
COPY framework-server/ /opt/wasm-game-framework/server/
COPY package.json /opt/wasm-game-framework/package.json

ENV WASM_GAME_FRAMEWORK_VERSION=${FRAMEWORK_VERSION}
ENV WASM_GAME_HTTP_PORT=8088
VOLUME ["/data"]
EXPOSE 8088
ENTRYPOINT ["/usr/local/bin/wasm-game-entrypoint"]
