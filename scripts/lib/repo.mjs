// El repo de la Fábrica, en un solo sitio. Los .mjs lo importan; los ficheros que no pueden
// importarlo (apps/*.ps1, apps/crear-apps.html, PASOS-PABLO.md) lo copian y test/repo.test.js
// comprueba que cada copia coincide con este valor.
export const REPO = 'factory-am89/fabrica';
// Client id de la App fabrica-constructor. No es secreto (el secreto es la clave privada, en 1Password):
// vive junto al repo para que ninguna sesión dependa de que alguien se lo pase.
export const CLIENT_ID_CONSTRUCTOR = 'Iv23liur4l1hSrzmpd7h';
// Slug de la App que publica el check `revisor` (apps/crear-apps.html la crea con este nombre; test/override.test.js lo comprueba).
export const REVISOR_APP_SLUG = 'fabrica-revisor';
// Slug de la App administradora (apps/crear-apps.html la crea con este nombre; test/apps.test.js lo comprueba).
export const ADMIN_APP_SLUG = 'fabrica-administrador';
// La cuenta de GitHub de Pablo (admin de la Fábrica; comprobado con la API el 16 oct 2026). Es la única cuyas
// aprobaciones anulan al revisor (scripts/veredicto.mjs). Un login, nunca un correo.
export const OWNER_LOGIN = 'pabloam89';
