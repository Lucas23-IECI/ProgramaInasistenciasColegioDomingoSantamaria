#!/bin/sh
set -eu
umask 077

if [ "${CONFIRM_RESTORE:-}" != "SI_RESTAURAR" ]; then
  echo "Restauracion cancelada. Defina CONFIRM_RESTORE=SI_RESTAURAR en un entorno aislado." >&2
  exit 2
fi

if [ "$#" -ne 3 ]; then
  echo "Uso: restore.sh respaldo.dump documentos.tar.gz manifiesto.sha256" >&2
  exit 2
fi

DB_BACKUP="$1"
FILES_BACKUP="$2"
MANIFEST="$3"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
STAGING_DIR=""

case "$UPLOADS_DIR" in
  ''|/|/app|/bin|/boot|/dev|/etc|/home|/lib|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
    echo "UPLOADS_DIR no apunta a un directorio de documentos seguro." >&2
    exit 2
    ;;
esac

for required_file in "$DB_BACKUP" "$FILES_BACKUP" "$MANIFEST"; do
  if [ ! -s "$required_file" ]; then
    echo "Archivo de restauracion ausente o vacio: $required_file" >&2
    exit 2
  fi
done

DB_NAME_ONLY="$(basename "$DB_BACKUP")"
FILES_NAME_ONLY="$(basename "$FILES_BACKUP")"
MANIFEST_DIR="$(dirname "$MANIFEST")"

if ! awk -v database="$DB_NAME_ONLY" -v documents="$FILES_NAME_ONLY" '
  NF != 2 { exit 1 }
  $2 == database { database_count += 1; next }
  $2 == documents { documents_count += 1; next }
  { exit 1 }
  END { exit !(database_count == 1 && documents_count == 1) }
' "$MANIFEST"; then
  echo "El manifiesto no contiene exactamente los dos archivos esperados." >&2
  exit 2
fi

if [ "$(dirname "$DB_BACKUP")" != "$MANIFEST_DIR" ] || [ "$(dirname "$FILES_BACKUP")" != "$MANIFEST_DIR" ]; then
  echo "El respaldo y su manifiesto deben encontrarse en el mismo directorio." >&2
  exit 2
fi

(
  cd "$MANIFEST_DIR"
  sha256sum -c "$(basename "$MANIFEST")" >/dev/null
)
pg_restore --list "$DB_BACKUP" >/dev/null

if ! tar -tzf "$FILES_BACKUP" | awk '
  /^\// || /^\.\.($|\/)/ || /\/\.\.($|\/)/ { unsafe = 1 }
  END { exit unsafe }
'; then
  echo "El archivo de documentos contiene una ruta no segura." >&2
  exit 2
fi

if ! tar -tvzf "$FILES_BACKUP" | awk '
  substr($1, 1, 1) != "-" && substr($1, 1, 1) != "d" { unsafe = 1 }
  END { exit unsafe }
'; then
  echo "El archivo de documentos contiene enlaces o tipos de archivo no permitidos." >&2
  exit 2
fi

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT HUP INT TERM
tar -xzf "$FILES_BACKUP" -C "$STAGING_DIR"

echo "Restaurando base de datos en una transaccion unica..."
pg_restore --clean --if-exists --no-owner --single-transaction \
  -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" "$DB_BACKUP"

mkdir -p "$UPLOADS_DIR"
find "$UPLOADS_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "$STAGING_DIR"/. "$UPLOADS_DIR"/

echo "Restauracion completada y verificada. Ejecute las pruebas de salud antes de habilitar acceso."
