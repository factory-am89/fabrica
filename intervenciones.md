# Intervenciones de Pablo

Una línea cada vez que Pablo tiene que intervenir (un permiso, un clic, una decisión, un arreglo a mano), con su porqué. Si el mismo porqué se repite, deja de ser una intervención: se convierte en un check o en un hook, y la línea lo dice.

Formato, una línea por intervención, la más nueva abajo:

`AAAA-MM-DD | tipo | qué hizo Pablo | por qué hizo falta | repetida: no / sí (#issue o PR del check)`

Tipos: `permiso`, `decisión`, `clic`, `arreglo`.

Los avisos de permiso y los comandos `!` ya se cuentan solos, sin texto, en `~/.fabrica/intervenciones.jsonl` (hooks en `.claude/settings.json`); `npm run hitl -- --json` los cuenta por clase. Esta tabla es para lo que ningún hook ve.

Motivo `arbitro` (decisión del orquestador): un PR que toca el árbitro (`.github/`, `scripts/veredicto.mjs`, `standards/`, `.claude/`) no lo aprueba el revisor automático: lo aprueba Pablo con **Approve** y un **Re-run** del job `revisor`. Cada vez es una línea (tipo `clic`, por qué `arbitro`, repetida: sí). Es el diseño y no se automatiza: quien cambia al árbitro no puede aprobarse a sí mismo.


2026-10-15 | decisión | Pablo decide que ningún cambio de la Factoría espera su aprobación: el revisor automático decide todo, también los cambios a su propio juez; este PR es el último que aprueba. Sustituye al motivo `arbitro` de la línea 11 | el árbitro humano frenaba cada PR que tocaba .github/, veredicto, estándar o .claude/ | repetida: no (https://github.com/pabloam89/fabrica/pull/2#issuecomment-6195673672)
2026-10-15 | clic | Pablo traspasa las dos Apps y los repos fabrica y homenu-panel a la organización factory-am89 (clics de propietario) | solo el propietario de la cuenta puede traspasar Apps y repositorios a una organización | repetida: no (este PR, rama ops/mudanza-org)
2026-10-16 | decisión | Pablo decided, in a Claude Code session on 2026-10-16 (there is no public link: it is a conversation, not a GitHub comment), to bring a token cache like MenuPlan's into the Fábrica | token.mjs read the .pem from 1Password on every gh/git call, and several agents in a loop hit "Too many requests" (the same failure MenuPlan had on 2026-10-10, recorded in .claude/skills/1password/SKILL.md) | repetida: sí (https://github.com/factory-am89/fabrica/pull/10: cache plus a test that counts .pem reads)
2026-10-16 | decisión | Pablo decide que las skills llevan fecha de última revisión y no caducidad dura | la caducidad rompía `tests` de todos los PR sin relación; C13 la tomaba por rebaja | repetida: no (conversación con Pablo en la sesión fabrica-dd, 2026-10-16, sin enlace público: no es un comentario de GitHub; sus palabras: «no deberían tenerlas [caducidad], sino más bien fecha de revisión/actualización»; respondió «1» a la opción de reabrir T0 como cambio de regla explícito, y «ok» a seguir con #19 y fusionarlo con acción de propietario)
2026-10-16 | decisión | Pablo chose which parts of .claude/ need him before work starts: only .claude/hooks/** and .claude/settings*.json (what runs by itself or grants permissions); skills and roles stay free; merges stay decided by the revisor check (line 16 stands) | the closed list in standards/intervention.md needed an owner decision; protecting all of .claude/ would put every skill and role edit behind him, against 0% HITL | repetida: no (conversation in the fabrica-ac session, 2026-10-16, no public link; he asked for the trade-offs, then for the option that optimises scalability, 0% HITL and agent-first infra, and answered «1» to «proteger solo ganchos y configuración»)
2026-10-16 | clic | Pablo levantó el ruleset de main para fusionar #40; #52 («fusionar solo» ya armado) entró en main en ese hueco sin el check revisor, y el revisor dijo «no» en C5 después (run 38919367096) | levantar el ruleset deja pasar lo que ya está armado, y apps/lib-proyecto.ps1 tragaba el JSON ilegible (`Json-De` devolvía $null: una lista de PR ilegible se tomaba por «no hay PR»); arreglo en fix/new-project-fail-loud: JSON ilegible o llamada fallida lanza con la salida de gh | repetida: no (el hueco del ruleset fue una vez; la causa técnica la cubre un test con mutación)
