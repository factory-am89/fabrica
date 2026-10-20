## What changes

`cumpleNode(version, rango)` en `scripts/lib/version-node.mjs`: dice si una versión de Node cumple el rango de `engines.node` de `package.json` (hoy `>=22`). Lanza con el valor recibido si la versión o el rango no son válidos. La compara con la librería `semver`, que entra en `dependencies` con versión exacta (`7.7.1`) y su entrada en `package-lock.json`. Con su test. Lo usará `npm run check-pc` en el siguiente trozo para avisar de un Node viejo; hoy no lo llama nada.

## Evidence

Produced by `npm run evidence`. HEAD f1b60d2; merge-base with origin/main 3a7c9e8.

```
$ node --test --test-reporter=spec test/version-node.test.js
ℹ tests 2
ℹ pass 2
ℹ fail 0
(exit 0)
```

```
$ npm run lint

> lint
> eslint . --max-warnings 0
(exit 0)
```

```
$ git diff --shortstat origin/main...HEAD
 4 files changed, 26 insertions(+), 2 deletions(-)
(exit 0)
```

## Red before

Sin el módulo, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/version-node.test.js
✖ test/version-node.test.js
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'scripts/lib/version-node.mjs'
ℹ tests 1
ℹ pass 0
ℹ fail 1
(exit 1)
```

## Decisions

None

## Not verified

- `npm ci` en una máquina limpia con el lock nuevo: no lo he lanzado.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
