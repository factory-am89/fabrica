# Cómo se registra una entidad

Una entidad es una clase de cosa con esquema en código (una lección, una skill, una pregunta). Vive en
`entities.json`, en un solo sitio. La forma la comprueba `test/entities.test.js` con `scripts/lib/entities.mjs`:
las reglas están en esa forja (`ENTITY_FAULTS`) y no se repiten aquí.

## Cómo se añade una

- Una fila en `entities.json` con los campos de MenuPlan (`ops/entidades.json`): `id`, `name`, `scope`,
  `term`, `source_of_truth`, `readers`.
- Un horizontal dice su `base` (esta carpeta, `base/`) y su `forge` (el código que lo comprueba), o es un hueco
  con su motivo. Los valores válidos están en `scripts/lib/entities.mjs` (`BASE_HOLE`, `HOLE_REASONS`); el hueco se cuenta, no se esconde.
- Toda ruta que nombre debe existir; `none` en `source_of_truth` significa que no tiene fichero propio.

## Verlo entero

`node scripts/entities.mjs --json` imprime el registro entero; falla en alto si tiene algún fallo.
