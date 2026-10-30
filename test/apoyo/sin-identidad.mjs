// Side-effect import for the test files that reach leerFicha or token.mjs through process.env (clean, tarea, retire...):
// it removes FABRICA_IDENTIDAD from this test process, so the result does not depend on the identity the PC running the
// suite has chosen (identidadActiva in scripts/lib/identities.mjs). Each test file runs in its own process, and the
// processes it spawns inherit the cleaned environment. test/identidad-activa.test.js checks that every such file imports it.
// node --test also runs this file on its own, harmlessly (no test, no output).
import { VARIABLE_IDENTIDAD } from '../../scripts/lib/identities.mjs';

delete process.env[VARIABLE_IDENTIDAD];
