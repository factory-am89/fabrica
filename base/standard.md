# Cómo se escribe un estándar

Un estándar (`standards/*.md`) es una lista de preguntas de sí o no que alguien comprueba. Su forja es
`readQuestions` en `scripts/lib/questions.mjs`: es el único lector de las preguntas y todo lo que exige
(`FIELDS`, `CHECKED_BY`, `ID_PARTS`, una letra por fichero) está allí, no se repite aquí.

## Cómo se añade una pregunta

- Con la forma que dicen esos nombres; quién la comprueba lo dice `CHECKED_BY`.
- Si cambia el estándar de código, el juez lo lee desde `main` tras fusionar.

Registrado como entidad `standard` en `entities.json`; la entidad `question` usa esta misma base.
