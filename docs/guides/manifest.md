# wasm-game.json

This file is the browser contract. The bootstrap merges the selected variant
over the root object and refuses to enable Play until the adapter matches
what you declared.

Create one with `npx create-wasm-game`. Then change only the fields you
mean. New manifests should always set `displayMode`, `menuCursor`,
`controller`, `persistence`, and `fullscreen` explicitly.

{{include:manifest-example}}

`description`, `loadingTitle`, and `pwa.description` must stay neutral.
Words like “upload”, “cache”, “files”, or “game data” belong in
`provisioningText`, which is shown only while required data is missing.

{{include:manifest-fields}}

## PWA

The server generates `/app.webmanifest` from this object. Adapters never
register their own worker or write a manifest file.

{{include:pwa-fields}}

## Controller and persistence objects

{{include:controller-fields}}

{{include:persistence-fields}}

A suite uses a top-level `variants` map. Each key becomes the variant id.
`?game=` selects one; `WASM_GAME_VARIANT` locks one. Persistence roots must
resolve to different IDBFS paths — use `{variant}` or `{namespace}`.
