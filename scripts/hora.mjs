// La hora de Pablo (Madrid), con Node y nunca con `date`: en Git Bash `TZ=Europe/Madrid date` da la hora UTC sin error
// (8 oct 2026: todas las horas límite salieron 2 h antes). `npm run hora` y paso «hora» del arranque.
import { fileURLToPath } from 'node:url';

export const horaDeMadrid = (ahora = new Date()) => ahora.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

const linea = (ahora) => `Hora local de Pablo (Madrid): ${horaDeMadrid(ahora)}`;

// El reloj se inyecta (función que da un Date) para poder probar verano e invierno.
export const pasoHora = (reloj = () => new Date()) => ({
  nombre: 'hora',
  ejecutar: (escribir) => escribir(linea(reloj())),
});

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(linea(new Date()));
