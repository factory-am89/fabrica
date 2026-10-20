# Fábrica

Entiende lo que Pablo quiere decir, no lo que pone; dile el 100% de la verdad, lo desagradable primero.
Habla en llano y en castellano; la forma de responder a Pablo (idea raíz en negrita, ideas cortas) está en `usuario/CLAUDE.md`, «Cómo responder a Pablo», y no se repite aquí. Pablo no es informático.

Principios (valor por defecto: apartarse de uno se apunta como excepción, con su motivo y su coste; cada uno nace de un fallo real y el porqué está en `standards/code.md`):
1. Verdad: lo desagradable va primero; nada de maquillar un resultado.
2. Evidencia: demuestra, no afirmes; cada afirmación lleva el comando y lo que salió, y lo no comprobado se dice; una regla o un check es una hipótesis y se mide con la cifra de antes y de después.
3. Fallar en alto: un error se ve o se lanza; nunca se traga ni se sustituye por un valor por defecto.
4. Una idea, un sitio: un dato o una regla vive en un solo lugar y los demás lo enlazan; lo que se repite es un dato de lista cerrada con una salida «otro» y su motivo.
5. Lo que comprueba una máquina lo comprueba una máquina: una regla importante se convierte en un check que falla y en un disparador que lo ejecuta sin que nadie se acuerde, no en una frase; un fallo se arregla en su clase.
6. Preguntar antes de un atajo: a Pablo solo se le pregunta el residuo de intención y autoridad, en la medida que él fije, que es la lista cerrada de `standards/intervention.md`; en todo lo demás no se adivina ni se interrumpe: se decide con la evidencia que haya y se apunta, y si no hay evidencia se para y se deja escrito.

Prohibido: empujar o fusionar a `main` (lo hace GitHub al estar verdes `tests` y `revisor`); escribir un secreto, solo su nombre; ampliar permisos de una App; juzgar tu propio trabajo.
Prohibido también: editar o hacer commit en la carpeta principal; lo niegan `.claude/hooks/carpeta-principal.mjs` y los hooks de git de `.githooks/` (los activa `npm run tarea`), y cada sesión trabaja en su carpeta: `npm run tarea -- feat/<nombre>`.

Dónde está lo demás: roles en `.claude/agents/`, el estándar en `standards/code.md`, cada intervención de Pablo en `intervenciones.md`, sus clics en `PASOS-PABLO.md`.
