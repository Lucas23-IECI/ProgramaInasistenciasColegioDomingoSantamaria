#!/bin/sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "SI_RESTAURAR" ]; then
  echo "Restauración cancelada. Defina CONFIRM_RESTORE=SI_RESTAURAR en un entorno aislado."
  exit 2
fi

if [ "$#" -ne 2 ]; then
  echo "Uso: restore.sh respaldo.dump documentos.tar.gz"
  exit 2
fi

DB_BACKUP="$1"
FILES_BACKUP="$2"
test -s "$DB_BACKUP"
test -s "$FILES_BACKUP"
pg_restore --list "$DB_BACKUP" >/dev/null
tar -tzf "$FILES_BACKUP" >/dev/null

echo "Restaurando base de datos en el destino configurado..."
pg_restore --clean --if-exists --no-owner -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" "$DB_BACKUP"
mkdir -p "${UPLOADS_DIR:-/uploads}"
tar -xzf "$FILES_BACKUP" -C "${UPLOADS_DIR:-/uploads}"
echo "Restauración completada. Ejecute pruebas de salud antes de habilitar acceso."
