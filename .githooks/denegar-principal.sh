# Lo cargan los hooks de git de esta carpeta. Niega en la carpeta principal, y solo ahí: en una
# carpeta de trabajo (worktree) el directorio de git propio no es el común y se deja pasar.
# No depende de cómo se escriba la orden: es git quien lo llama, con commit, merge o cherry-pick.
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] || return 0 2>/dev/null || exit 0
echo "La carpeta principal no se toca: una sesión, una carpeta, una rama. Crea la tuya con 'npm run tarea -- feat/<nombre>' (o fix/ u ops/) y trabaja ahí." >&2
exit 1
