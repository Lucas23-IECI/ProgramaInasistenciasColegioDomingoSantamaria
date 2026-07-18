# Operación, respaldo y recuperación

## Operación diaria

Antes del ingreso de estudiantes, la persona responsable debe:

1. Confirmar que el lector y el navegador funcionan.
2. Ejecutar `scripts\estado.ps1` en el PC servidor.
3. Verificar la hora límite configurada y la fecha del equipo.
4. Realizar una lectura de prueba con un registro ficticio autorizado y anularla después.

Durante la jornada, el lector registra entradas a tiempo o atrasadas. Los usuarios administrativos pueden consultar estudiantes, corregir registros, justificar atrasos, adjuntar documentos y revisar el historial. Toda corrección exige un motivo y queda registrada en auditoría.

Este sistema mide puntualidad y atrasos. No debe interpretarse como un sistema completo de asistencia, presentes o ausentes.

## Cierre diario recomendado

- Revisar registros rechazados o duplicados informados por el lector.
- Resolver correcciones pendientes con un motivo verificable.
- Registrar justificaciones recibidas y comprobar sus documentos.
- Exportar únicamente cuando exista una necesidad administrativa concreta.
- No enviar planillas con datos personales por cuentas o dispositivos no institucionales.

## Respaldos

El contenedor `ldsm_backup` crea un respaldo al iniciar y luego cada 24 horas. Cada conjunto contiene:

- base PostgreSQL en formato restaurable;
- documentos adjuntos comprimidos;
- manifiesto SHA-256 para verificar integridad;
- archivo `last-success.env` con la última ejecución válida.

Para crear uno inmediatamente:

```powershell
.\scripts\respaldo-ahora.ps1
```

La carpeta `backups` está en el PC servidor y no basta como única copia. Se recomienda copiar automáticamente los conjuntos a un disco externo cifrado o almacenamiento institucional con acceso restringido. La retención local predeterminada es de 30 días.

## Prueba de restauración

La restauración debe ensayarse al menos una vez por semestre en una copia aislada, nunca directamente sobre producción como primera prueba.

1. Seleccionar los tres archivos del mismo timestamp.
2. Verificar que el manifiesto, el `.dump` y el `.tar.gz` estén juntos.
3. Crear una base y un volumen de documentos desechables.
4. Ejecutar `backend/restore.sh` dentro de un contenedor PostgreSQL 16 con `CONFIRM_RESTORE=SI_RESTAURAR`.
5. Comprobar migraciones, cantidad de estudiantes, documentos y salud del backend antes de habilitar acceso.

El script rechaza manifiestos incompletos, archivos vacíos, rutas absolutas, recorridos `..`, enlaces y restauraciones sin confirmación explícita.

## Incidentes

Si la aplicación no responde:

1. Ejecutar `scripts\estado.ps1`.
2. Revisar `docker compose logs --tail 100 backend frontend postgres backup`.
3. Reiniciar con `docker compose restart` si no hay operaciones activas.
4. No borrar volúmenes, la carpeta `backups` ni el archivo `.env`.

Si se sospecha acceso indebido, desconectar el PC de la red, conservar los registros y respaldos, cambiar las credenciales desde un equipo confiable y documentar quién detectó el incidente, cuándo ocurrió y qué información pudo estar involucrada.

## Responsabilidades mínimas

- Dirección: aprobar responsables, política de conservación y procedimiento de incidentes.
- Inspectoría: definir y supervisar la operación diaria del control de atrasos.
- Secretaría o matrícula: mantener datos de estudiantes y cursos vigentes.
- Administración técnica: mantener el PC, red, Docker, respaldos y pruebas de recuperación.
- Administrador del sistema: gestionar usuarios, permisos y auditoría.
