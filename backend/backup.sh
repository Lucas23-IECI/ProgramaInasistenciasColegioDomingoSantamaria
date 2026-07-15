#!/bin/sh
BACKUP_DIR="/backups"
mkdir -p "$BACKUP_DIR"

# Generar un nombre de archivo único con la fecha y hora actual
FILE_NAME="backup_$(date +%Y%m%d_%H%M%S).sql"

echo "Iniciando pg_dump de la base de datos..."
pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" > "$BACKUP_DIR/$FILE_NAME"
echo "Respaldo completado exitosamente: $FILE_NAME"

# Mantener solo los últimos 7 días de respaldos
find "$BACKUP_DIR" -name "backup_*.sql" -mtime +7 -delete
echo "Limpieza de respaldos antiguos completada."
