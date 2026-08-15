# create-wasm-game

Scaffold a [WASM Game Framework](https://github.com/theodorecharles/wasm-game-framework) project.

```bash
npx create-wasm-game my-game
npm create wasm-game@latest my-game
```

The generated project owns `wasm-game.json`, `game-adapter.js`, data policy,
an exact framework pin, Docker build files, and the package-contract test. It
never writes `index.html`, launcher CSS, a service worker, or a web manifest.

Defaults: `displayMode: "4:3"`, `menuCursor: "browser"`, `controller.mode:
"disabled"`, persistence attached before native main, and neutral ready-state
copy.

See the framework documentation for the full contract.
