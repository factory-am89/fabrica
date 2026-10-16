# Intervenciones de Pablo

Una línea cada vez que Pablo tiene que intervenir (un permiso, un clic, una decisión, un arreglo a mano), con su porqué. Si el mismo porqué se repite, deja de ser una intervención: se convierte en un check o en un hook, y la línea lo dice.

Formato, una línea por intervención, la más nueva abajo:

`AAAA-MM-DD | tipo | qué hizo Pablo | por qué hizo falta | repetida: no / sí (#issue o PR del check)`

Tipos: `permiso`, `decisión`, `clic`, `arreglo`.

Motivo `arbitro` (decisión del orquestador): un PR que toca el árbitro (`.github/`, `scripts/veredicto.mjs`, `estandares/`, `.claude/`) no lo aprueba el revisor automático: lo aprueba Pablo con **Approve** y un **Re-run** del job `revisor`. Cada vez es una línea (tipo `clic`, por qué `arbitro`, repetida: sí). Es el diseño y no se automatiza: quien cambia al árbitro no puede aprobarse a sí mismo.


2026-10-15 | decisión | Pablo decide que ningún cambio de la Factoría espera su aprobación: el revisor automático decide todo, también los cambios a su propio juez; este PR es el último que aprueba. Sustituye al motivo `arbitro` de la línea 11 | el árbitro humano frenaba cada PR que tocaba .github/, veredicto, estándar o .claude/ | repetida: no (https://github.com/pabloam89/fabrica/pull/2#issuecomment-6195673672)
2026-10-15 | clic | Pablo traspasa las dos Apps y los repos fabrica y homenu-panel a la organización factory-am89 (clics de propietario) | solo el propietario de la cuenta puede traspasar Apps y repositorios a una organización | repetida: no (este PR, rama ops/mudanza-org)
2026-10-16 | decisión | Pablo decided to copy MenuPlan's token cache into the Fábrica | "Too many requests" from 1Password: token.mjs read the .pem on every gh/git call, as in MenuPlan on 2026-10-10 | repetida: sí (feat/token-cache: cache and read count)
