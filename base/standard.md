# Cómo se escribe un estándar

Un estándar (`standards/*.md`) es una lista de preguntas de sí o no que alguien comprueba. Su forja es
`readQuestions` en `scripts/lib/questions.mjs`: es el único lector de las preguntas y la forma que exige
(cabecera `### <letra><n> — texto`, línea `Quién:`, `Bien:` y `Mal:`) está allí, no se repite aquí.

## Cómo se añade una pregunta

- Una letra por fichero (`C` en `standards/code.md`, `P` en `standards/plan.md`) y número correlativo.
- `Quién: máquina` solo si un check la falla de verdad; si no, `Quién: revisor`.
- Si cambia el estándar de código, el juez lo lee desde `main` tras fusionar.

Registrado como entidad `standard` en `entities.json`.
