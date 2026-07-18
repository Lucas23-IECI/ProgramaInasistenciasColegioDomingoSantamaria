#!/bin/sh
set -eu
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
MIRROR_DIR="${BACKUP_MIRROR_DIR:-}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DB_FILE="${BACKUP_DIR}/ldsm_db_${TIMESTAMP}.dump"
DB_TEMP="${DB_FILE}.tmp"
FILES_FILE="${BACKUP_DIR}/ldsm_documentos_${TIMESTAMP}.tar.gz"
FILES_TEMP="${FILES_FILE}.tmp"
MANIFEST="${BACKUP_DIR}/ldsm_${TIMESTAMP}.sha256"
MANIFEST_TEMP="${MANIFEST}.tmp"
STATUS_FILE="${BACKUP_DIR}/last-success.env"
STATUS_TEMP="${STATUS_FILE}.tmp"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*)
    echo "BACKUP_RETENTION_DAYS debe ser un numero entero positivo." >&2
    exit 2
    ;;
esac

if [ "$RETENTION_DAYS" -lt 1 ]; then
  echo "BACKUP_RETENTION_DAYS debe ser mayor que cero." >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
cleanup() {
  rm -f "$DB_TEMP" "$FILES_TEMP" "$MANIFEST_TEMP" "$STATUS_TEMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

echo "[$(date -Iseconds)] Iniciando respaldo verificado."
pg_dump -Fc -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$DB_TEMP"
test -s "$DB_TEMP"
pg_restore --list "$DB_TEMP" >/dev/null
mv "$DB_TEMP" "$DB_FILE"

tar -czf "$FILES_TEMP" -C /uploads .
tar -tzf "$FILES_TEMP" >/dev/null
mv "$FILES_TEMP" "$FILES_FILE"

DB_NAME_ONLY="$(basename "$DB_FILE")"
FILES_NAME_ONLY="$(basename "$FILES_FILE")"
MANIFEST_NAME_ONLY="$(basename "$MANIFEST_TEMP")"

(
  cd "$BACKUP_DIR"
  sha256sum "$DB_NAME_ONLY" "$FILES_NAME_ONLY"
) > "$MANIFEST_TEMP"
(
  cd "$BACKUP_DIR"
  sha256sum -c "$MANIFEST_NAME_ONLY" >/dev/null
)
mv "$MANIFEST_TEMP" "$MANIFEST"

printf 'timestamp=%s\ndatabase=%s\ndocuments=%s\nmanifest=%s\n' \
  "$(date -Iseconds)" \
  "$DB_NAME_ONLY" \
  "$FILES_NAME_ONLY" \
  "$(basename "$MANIFEST")" > "$STATUS_TEMP"
mv "$STATUS_TEMP" "$STATUS_FILE"

if [ -n "$MIRROR_DIR" ]; then
  case "$MIRROR_DIR" in
    /|"$BACKUP_DIR"|"$BACKUP_DIR"/*)
      echo "BACKUP_MIRROR_DIR debe apuntar a una ubicacion distinta y segura." >&2
      exit 2
      ;;
  esac

  mkdir -p "$MIRROR_DIR"
  for source in "$DB_FILE" "$FILES_FILE" "$MANIFEST"; do
    destination="${MIRROR_DIR}/$(basename "$source")"
    cp "$source" "${destination}.tmp"
    mv "${destination}.tmp" "$destination"
  done
  cp "$STATUS_FILE" "${MIRROR_DIR}/last-success.env.tmp"
  mv "${MIRROR_DIR}/last-success.env.tmp" "${MIRROR_DIR}/last-success.env"
fi

find "$BACKUP_DIR" -type f \( -name 'ldsm_db_*.dump' -o -name 'ldsm_documentos_*.tar.gz' -o -name 'ldsm_*.sha256' \) -mtime "+$RETENTION_DAYS" -delete
echo "[$(date -Iseconds)] Respaldo verificado: $DB_NAME_ONLY, $FILES_NAME_ONLY."
echo "[$(date -Iseconds)] Retencion local de ${RETENTION_DAYS} dias aplicada."
