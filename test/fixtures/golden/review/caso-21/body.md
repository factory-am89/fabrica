## What changes

Dos comandos nuevos para mirar la rama sin escribir el `git` a mano:

- `node scripts/cabeza.mjs` imprime la cabeza de la rama y su base con `origin/main`, en corto (es la línea que cada PR copia a `Evidence`: «HEAD …; base …»).
- `node scripts/cambios.mjs` imprime los ficheros que la rama cambia respecto a esa base, uno por línea.

Los dos paran con código 1 y dicen qué orden de `git` falló. Un test los lanza como comandos en un repo temporal. Hoy los llama una persona; ningún otro script los usa todavía.

## Evidence

Produced by `npm run evidence`. HEAD e47a1d8; merge-base with origin/main 0b5c3f9.

```
$ node --test --test-reporter=spec test/cabeza-y-cambios.test.js
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
 3 files changed, 66 insertions(+)
(exit 0)
```

## Red before

Sin los dos scripts, el test nuevo da rojo:

```
$ node --test --test-reporter=spec test/cabeza-y-cambios.test.js
✖ cabeza y cambios: una rama con un commit sobre origin/main
✖ cabeza y cambios: fuera de un repo salen con 1 y dicen qué git falló
ℹ tests 2
ℹ pass 0
ℹ fail 2
(exit 1)
```

## Decisions

None

## Not verified

- Los comandos en Windows con una rama cuyo nombre lleva caracteres raros: el test usa `feat/x`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
