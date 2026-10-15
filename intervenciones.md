# Intervenciones de Pablo

Una línea cada vez que Pablo tiene que intervenir (un permiso, un clic, una decisión, un arreglo a mano), con su porqué. Si el mismo porqué se repite, deja de ser una intervención: se convierte en un check o en un hook, y la línea lo dice.

Formato, una línea por intervención, la más nueva abajo:

`AAAA-MM-DD | tipo | qué hizo Pablo | por qué hizo falta | repetida: no / sí (#issue o PR del check)`

Tipos: `permiso`, `decisión`, `clic`, `arreglo`.

Motivo `arbitro` (decisión del orquestador): un PR que toca el árbitro (`.github/`, `scripts/veredicto.mjs`, `estandares/`, `.claude/`) no lo aprueba el revisor automático: lo aprueba Pablo con **Approve** y un **Re-run** del job `revisor`. Cada vez es una línea (tipo `clic`, por qué `arbitro`, repetida: sí). Es el diseño y no se automatiza: quien cambia al árbitro no puede aprobarse a sí mismo.

