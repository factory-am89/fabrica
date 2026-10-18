# proyectos/

Cada `proyectos/<repo>.json` declara un repo de `factory-am89` que la Fábrica administra: el nombre del fichero es el nombre del repo.

- **Esquema:** lo define y lo hace cumplir `parseProject` en [`scripts/admin/proyecto.mjs`](../scripts/admin/proyecto.mjs). Es la única fuente: no se copia aquí; si algo no cuadra, manda esa función. Ejemplo vivo: [`homenu-panel.json`](homenu-panel.json).
- **Qué dispara fusionarlo:** un push a `main` que toque `proyectos/**` o `scripts/admin/**` lanza [`administrar.yml`](../.github/workflows/administrar.yml). Ese run escribe de verdad en GitHub: el environment `revisor` y sus secretos, los ficheros directos en `main`, los ajustes del repo y el ruleset de `main`. Fusionar un `.json` es, por tanto, ordenar esos cambios.
- **Repos privados:** se rechazan (`parseProject` falla): el plan gratuito de GitHub no admite rulesets en repos privados y `main` no se podría proteger.
- **Otros ficheros:** los lectores solo miran los `*.json` de esta carpeta, así que este README no cuenta como proyecto (aun así, tocarlo también dispara `administrar.yml`).
