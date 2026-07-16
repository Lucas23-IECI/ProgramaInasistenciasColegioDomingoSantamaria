# Plan de integración institucional

## Objetivo

Preparar el sistema para una integración controlada en el Liceo Domingo Santa María, protegiendo datos personales, credenciales, certificados médicos y continuidad operacional. La entrega debe ser comprensible para personal no técnico, verificable y reversible.

## Alcance de esta etapa

- Seguridad de credenciales, sesiones, roles y endpoints.
- Integridad de matrículas y registros duplicados.
- Migraciones de base de datos versionadas y arranque seguro.
- Gestión segura y persistente de certificados y justificativos.
- Respaldos verificables de PostgreSQL y archivos.
- Endurecimiento de Docker y Nginx.
- Interfaz de pantalla completa, legible y accesible para usuarios de 40 a 50 años o más.
- Pruebas automáticas, validación de compilación y prueba visual en navegador.

## Fuera de alcance, por decisión pendiente

No se cambiarán en esta etapa:

- El cálculo actual de presentes, atrasos e inasistencias.
- La inferencia automática de ausencias.
- El calendario escolar y los días lectivos.
- El cierre diario de jornada.
- Los nuevos estados `pendiente`, `presente`, `atrasado`, `ausente` y `justificado`.
- La matrícula histórica con períodos de vigencia.

Estas decisiones requieren una conversación funcional con el establecimiento antes de modificar estadísticas o alertas.

## Principios de diseño

1. Ninguna contraseña proveniente del ERP se almacena, devuelve o replica.
2. Importar personas no crea cuentas de acceso al sistema.
3. Cada respuesta API devuelve solamente los campos necesarios para su función.
4. Los certificados solo son accesibles para administración y secretaría.
5. Los archivos se validan por contenido, no solo por nombre o extensión.
6. Un documento puede justificar varios días sin romperse al revocar uno de ellos.
7. La base no debe aceptar duplicados que la aplicación considera inválidos.
8. El servidor no anuncia disponibilidad hasta terminar esquema, migraciones y conexión a PostgreSQL.
9. Un respaldo no se considera válido hasta comprobar que puede ser leído.
10. La interfaz prioriza legibilidad, orientación, controles grandes y lenguaje directo.

## Fases y criterios de aceptación

### Fase 1: protección de datos

- Eliminar `alumno.contrasena` del esquema y de instalaciones existentes.
- Limpiar claves de contraseña existentes en snapshots JSON.
- Sustituir `SELECT a.*` por proyecciones explícitas.
- Separar importación ERP de creación de usuarios del sistema.
- Validar roles y contraseñas de cuentas administrativas.
- Impedir eliminar la sesión propia o el último administrador.
- Registrar en auditoría creación, edición y eliminación de usuarios.

Aceptación: ninguna respuesta o snapshot contiene campos de contraseña y una importación no cambia cuentas del sistema.

### Fase 2: integridad y migraciones

- Incorporar migraciones ordenadas y registradas en `schema_migrations`.
- Garantizar una sola matrícula actual por alumno, sin introducir períodos históricos todavía.
- Garantizar un registro único por alumno, fecha y tipo.
- Configurar explícitamente `America/Santiago`.
- Hacer que un error de migración impida iniciar el servidor.

Aceptación: las migraciones son idempotentes, los índices existen y el servidor falla de forma cerrada ante una base incompleta.

### Fase 3: certificados y justificativos

- Crear una entidad de documentos con nombre original, nombre interno, MIME, tamaño, hash, autor y fecha.
- Admitir únicamente PDF, PNG y JPEG con un máximo de 8 MiB.
- Verificar firma binaria y codificación Base64.
- Escribir archivos de forma asíncrona, con nombre aleatorio y permisos restringidos.
- Asociar un documento a uno o varios registros de asistencia.
- Eliminar el archivo solo cuando no existan referencias.
- Mantener compatibilidad de lectura con adjuntos heredados durante la transición.
- Persistir archivos en un volumen Docker dedicado.

Aceptación: los casos de carga válida, extensión falsa, archivo sobredimensionado, rango de días, revocación parcial y descarga no autorizada tienen pruebas.

### Fase 4: operación y respaldos

- Ejecutar un respaldo al iniciar el servicio y luego cada 24 horas.
- Crear el dump en archivo temporal y publicarlo solo después de verificarlo.
- Respaldar también certificados.
- Generar sumas SHA-256.
- Mantener siete días localmente.
- Documentar verificación y restauración en un entorno separado.
- Incorporar health checks reales y límites de memoria.

Aceptación: Compose valida, los servicios reportan salud y el procedimiento de restauración es reproducible sin tocar producción.

### Fase 5: UI y UX institucional

- Usar el ancho completo disponible y eliminar el patrón de panel centrado dentro de una caja.
- Mantener líneas de lectura razonables en textos, pero no limitar módulos ni tablas a tarjetas pequeñas.
- Tamaño base mínimo de 16 px, controles de al menos 44 px y contraste WCAG AA.
- Navegación estable, encabezados claros, acciones con texto y no solo iconos.
- Reemplazar alertas nativas por notificaciones y confirmaciones accesibles.
- Proporcionar estados visibles de carga, error, vacío y sesión expirada.
- Permitir teclado, zoom del navegador y resoluciones desde 1280x720 hasta escritorio amplio.

Aceptación: login, menú, lector, estudiantes, usuarios, atrasos, inasistencias, analítica y auditoría se revisan visualmente en escritorio y viewport reducido.

## Puertas de verificación

Una fase no se considera terminada hasta pasar:

1. `npm test` del backend.
2. `npm audit` del backend sin vulnerabilidades altas o críticas.
3. `npm run lint` del frontend.
4. `npm run build` del frontend.
5. `npm audit` del frontend sin vulnerabilidades altas o críticas.
6. `docker compose config --quiet`.
7. Migración sobre una base nueva y sobre una base existente de prueba.
8. Smoke test autenticado por rol.
9. Prueba de carga, descarga y revocación de certificado.
10. Revisión visual y de teclado en navegador.

## Estrategia Git y recuperación

- Rama de trabajo: `feature/integracion-institucional-20260715`.
- Commits separados por responsabilidad y escritos en español.
- No integrar a `test` hasta que todas las puertas estén verdes.
- No integrar a `main` hasta una validación manual con datos ficticios.
- Antes de migrar una base con datos, generar dump y respaldo de archivos verificados.
- Una migración fallida debe abortar el arranque; nunca continuar parcialmente.

## Decisiones pendientes con el establecimiento

- Hora exacta en que un alumno sin ingreso pasa a ausente.
- Tratamiento de retiros anticipados y jornadas parciales.
- Feriados, suspensiones y actividades fuera del recinto.
- Vigencia histórica de matrículas y cambios de curso.
- Umbrales institucionales de alertas y responsables de notificación.
- Retención legal de certificados, auditoría y datos de exalumnos.

