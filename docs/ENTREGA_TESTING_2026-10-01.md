# Entrega a testing — 1 de octubre de 2026

## Destino y decisión

Repositorio: `Lucas23-IECI/ProgramaInasistenciasColegioDomingoSantamaria` (público).

- Rama autorizada para esta entrega: **testing**. No existe una rama llamada `testeo`.
- Base de los cambios locales: `c6ac038559e48c7b963eb891be3dd77bab8df30d`.
- `main` debe permanecer en `af3a0635fc39d83adf95a1e1e1b0c2398b8d79ed`, por decisión expresa del usuario después de conocer el bloqueo de Docker.
- La optimización de tamaño queda aplazada. No se aumentan límites ni se omiten controles.
- Subir a testing no autoriza instalación en el colegio, ejecución de migraciones ni actualización de su base de datos.

## Contenido acumulado

Tareas internas, agenda, recursos, búsqueda global, reversión trazable de importaciones, mejoras de permisos/sesión/PWA, analítica/documentos/notificaciones/Portería, chat completo y flotante con fotos/grupos/apariencia, preparación HTTPS para Windows, pruebas y documentación. Incluye la corrección del alta manual reportada el 30 de septiembre. Se conserva el historial previo de testing, que ya contiene 40 commits posteriores a main.

La entrega incluye las migraciones 049 a 054 como archivos; **no se ejecutaron en esta ronda**. Se preservaron los cambios previos del repositorio. No se incorporan `.env`, certificados privados, respaldos, videos, archivos operacionales ni resultados generados de pruebas.

## Verificación nueva antes de subir

| Comprobación | Resultado |
| --- | --- |
| Backend: sintaxis | Aprobada |
| Backend: pruebas con cobertura | 290/290; umbrales aprobados (líneas 71,23%, ramas 69,98%, funciones 80,11%) |
| Frontend: ESLint | Aprobado |
| Frontend: pruebas Node | 155/155 |
| Cuestionarios: pruebas Node | 7/7 |
| Revisión de whitespace de los cambios | Aprobada |
| Búsqueda focalizada de secretos y comparación contra valores privados locales | Sin coincidencias de credenciales reales en los archivos candidatos; los tres marcadores de clave privada corresponden a tests, no a claves |

La compilación y el recorrido del alta manual sobre el build se ejecutaron en el cierre inmediatamente anterior, sobre el mismo código funcional: 47 comprobaciones de navegador y 8 adicionales de ayuda/novedades. API simulada, sin persistencia en PostgreSQL. [Informe](CORRECCION_ALTA_MANUAL_2026-10-01.md).

Logs locales adicionales: `output/release-backend-20261001.log`, `output/release-frontend-20261001.log`, `output/release-questionnaires-20261001.log`, `output/release-backend-audit-20261001.log` y `output/release-frontend-audit-detail-20261001.json`.

## Bloqueos abiertos: no instalar esta entrega como producción

1. **Peso del frontend:** excede los límites totales de JS/CSS documentados en el informe del alta manual. `frontend/Dockerfile` ejecuta `npm run test:performance`; por tanto no basta que `vite build` pase para afirmar que la imagen Docker se construye.
2. **Auditoría de dependencias actualizada:** la consulta de esta ronda informa dos dependencias de severidad alta en frontend (`axios` y `brace-expansion`) y una moderada en backend (`ip-address`). npm indica que existen correcciones. No se actualizaron dependencias ni se ignoraron avisos para esta publicación de testing. Los avisos no equivalen a una demostración de explotación de la app, pero los controles correspondientes fallan.
3. **Validación remota:** GitHub Actions debe interpretarse por su resultado real. Se espera que los controles anteriores impidan un resultado global verde. Una subida correcta de Git no acredita aprobación de CI ni funcionamiento en el servidor del colegio.

Antes de promover a main: resolver las dependencias, atender o decidir expresamente la política de peso y repetir construcción Docker/CI y regresión pertinente. El usuario dejó main sin cambios por ahora.
