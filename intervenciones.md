# Intervenciones de Pablo

Una línea cada vez que Pablo tiene que intervenir (un permiso, un clic, una decisión, un arreglo a mano), con su porqué. Si el mismo porqué se repite, deja de ser una intervención: se convierte en un check o en un hook, y la línea lo dice.

Formato, una línea por intervención, la más nueva abajo:

`AAAA-MM-DD | tipo | qué hizo Pablo | por qué hizo falta | repetida: no / sí (#issue o PR del check)`

Tipos: `permiso`, `decisión`, `clic`, `arreglo`.

Motivo `arbitro` (decisión del orquestador): un PR que toca el árbitro (`.github/`, `scripts/veredicto.mjs`, `estandares/`, `.claude/`) no lo aprueba el revisor automático: lo aprueba Pablo con **Approve** y un **Re-run** del job `revisor`. Cada vez es una línea (tipo `clic`, por qué `arbitro`, repetida: sí). Es el diseño y no se automatiza: quien cambia al árbitro no puede aprobarse a sí mismo.


2026-10-15 | decisión | Pablo decide que ningún cambio de la Factoría espera su aprobación: el revisor automático decide todo, también los cambios a su propio juez; este PR es el último que aprueba. Sustituye al motivo `arbitro` de la línea 11 | el árbitro humano frenaba cada PR que tocaba .github/, veredicto, estándar o .claude/ | repetida: no (https://github.com/pabloam89/fabrica/pull/2#issuecomment-6195673672)
2026-10-15 | clic | Pablo traspasa las dos Apps y los repos fabrica y homenu-panel a la organización factory-am89 (clics de propietario) | solo el propietario de la cuenta puede traspasar Apps y repositorios a una organización | repetida: no (este PR, rama ops/mudanza-org)
2026-10-16 | decisión | Pablo decided, in a Claude Code session on 2026-10-16 (there is no public link: it is a conversation, not a GitHub comment), to bring a token cache like MenuPlan's into the Fábrica | token.mjs read the .pem from 1Password on every gh/git call, and several agents in a loop hit "Too many requests" (the same failure MenuPlan had on 2026-10-10, recorded in .claude/skills/1password/SKILL.md) | repetida: sí (https://github.com/factory-am89/fabrica/pull/10: cache plus a test that counts .pem reads)
2026-10-16 | decisión | Pablo decide que las skills llevan fecha de última revisión y no caducidad dura | la caducidad rompía `tests` de todos los PR sin relación; C13 la tomaba por rebaja | repetida: no (conversación con Pablo en la sesión fabrica-dd, 2026-10-16, sin enlace público: no es un comentario de GitHub; sus palabras: «no deberían tenerlas [caducidad], sino más bien fecha de revisión/actualización»; respondió «1» a la opción de reabrir T0 como cambio de regla explícito, y «ok» a seguir con #19 y fusionarlo con acción de propietario)
