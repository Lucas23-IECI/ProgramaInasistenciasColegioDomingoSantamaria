# Entrega a testing — 1 de octubre de 2026

> Nueva decisión del usuario: se autoriza promover a main después de corregir el control de tamaño y verificar la construcción real. Este documento conserva la entrega histórica del 1 de octubre; su restricción de mantener main sin cambios ha sido sustituida. [Estado de la nueva preparación](PUBLICACION_MAIN_2026-10-04.md).

> Estado histórico intermedio, 4 de octubre: las dependencias se resolvieron localmente y las regresiones/exportaciones aprobaron; entonces el peso seguía aplazado y main permanecía sin cambios. Esa limitación fue sustituida por la nueva decisión de arriba. [Evidencia de la ronda intermedia](CIERRE_CORRECCIONES_2026-10-04.md). El resto describe la entrega del 1 de octubre, no el estado actual.

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
3. **Validación remota bloqueada:** la [ejecución 36954731973](https://github.com/Lucas23-IECI/ProgramaInasistenciasColegioDomingoSantamaria/actions/runs/36954731973), correspondiente a `a9b808b765ccf0545eec1fb2d25a61ec662845df`, terminó en fallo sin iniciar ninguno de sus cinco trabajos. Las cinco anotaciones indican: `The job was not started because your account is locked due to a billing issue.` No son pruebas remotas ejecutadas ni fallos funcionales demostrados; el bloqueo de cuenta impidió arrancarlas. No se modificó facturación ni configuración de la cuenta. Los fallos locales de peso/dependencias siguen siendo independientes y reales.

Antes de promover a main: resolver las dependencias, atender o decidir expresamente la política de peso y repetir construcción Docker/CI y regresión pertinente. El usuario dejó main sin cambios por ahora.

## Subida comprobada

Se publicaron diez commits temáticos desde `c6ac038` hasta `a9b808b` en `origin/testing`, seguidos de un commit documental para registrar el resultado remoto. La consulta directa de referencias confirmó `testing` en el commit publicado y `main` conservada en `af3a0635fc39d83adf95a1e1e1b0c2398b8d79ed`. No se hizo merge, force-push, despliegue ni migración. Los cambios de código quedaron incluidos; el directorio `output/` conserva evidencia local ignorada por Git.
