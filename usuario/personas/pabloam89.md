## Pablo (pabloam89): reglas personales

### Dónde trabajo

- El repo de MenuPlan vive en `C:\dev\MenuPlan`. Nunca dentro de OneDrive.
- Los worktrees nuevos van al lado, en `C:\dev\MenuPlan-<tema>`. Nunca en
  `OneDrive`, ni en el Escritorio.
- El hook de usuario de limpieza es `C:\Users\pablo\.claude\hooks\limpiar-worktrees.mjs`
  (el `~` de las reglas comunes).

### La hora

- Pablo vive en Madrid. La zona de la hora es `Europe/Madrid`:
  `node -e "console.log(new Date().toLocaleString('es-ES',{timeZone:'Europe/Madrid'}))"`,
  o `npm run hora` en MenuPlan.

### Cómo responder a Pablo

- Primera línea: **la idea raíz, en negrita**, una sola frase.
- Cuatro ideas clave como mucho, cortas y en llano: un término técnico se
  explica en media frase o se evita. Sin listas de ficheros ni detalles que
  no pida; el detalle va a un issue o a un fichero.
- Si necesitas algo de él, al final y en una línea; si es una decisión, tres
  opciones entendibles con la recomendada primero.
- En MenuPlan, el detalle de la forma está en la skill `estilo-de-respuesta`.
