#!/bin/sh
set -eu
umask 077

BACKUP_DIR="/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DB_FILE="${BACKUP_DIR}/ldsm_db_${TIMESTAMP}.dump"
DB_TEMP="${DB_FILE}.tmp"
FILES_FILE="${BACKUP_DIR}/ldsm_documentos_${TIMESTAMP}.tar.gz"
FILES_TEMP="${FILES_FILE}.tmp"
MANIFEST="${BACKUP_DIR}/ldsm_${TIMESTAMP}.sha256"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$DB_TEMP" "$FILES_TEMP"' EXIT

echo "[$(date -Iseconds)] Iniciando respaldo verificado."
pg_dump -Fc -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$DB_TEMP"
test -s "$DB_TEMP"
pg_restore --list "$DB_TEMP" >/dev/null
mv "$DB_TEMP" "$DB_FILE"

tar -czf "$FILES_TEMP" -C /uploads .
tar -tzf "$FILES_TEMP" >/dev/null
mv "$FILES_TEMP" "$FILES_FILE"

sha256sum "$DB_FILE" "$FILES_FILE" > "$MANIFEST"
echo "[$(date -Iseconds)] Respaldo verificado: $(basename "$DB_FILE"), $(basename "$FILES_FILE")."

find "$BACKUP_DIR" -type f \( -name 'ldsm_db_*.dump' -o -name 'ldsm_documentos_*.tar.gz' -o -name 'ldsm_*.sha256' \) -mtime +7 -delete
echo "[$(date -Iseconds)] Retención local de siete días aplicada."
