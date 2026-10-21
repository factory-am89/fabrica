// Quita de la lista de confianza de Node las raíces emSign (eMudhra). Por qué y cómo se instala: scripts/sin-emsign.mjs.
// Se carga en cada proceso Node del PC con NODE_OPTIONS=--require <este fichero>. Si este Node no sabe cambiar la lista,
// falla en alto: mejor un error que seguir confiando en silencio.
'use strict';
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

if (typeof tls.setDefaultCACertificates !== 'function') {
  throw new Error(`sin-emsign: Node ${process.version} no sabe cambiar su lista de CA (tls.setDefaultCACertificates, desde 22.19 y 24.5); actualiza Node o quita NODE_OPTIONS`);
}
const todas = tls.getCACertificates('default');
const fuera = todas.filter((pem) => /emSign/.test(new X509Certificate(pem).subject));
if (fuera.length) tls.setDefaultCACertificates(todas.filter((pem) => !fuera.includes(pem)));
