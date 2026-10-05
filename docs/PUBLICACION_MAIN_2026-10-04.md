# Preparación y publicación autorizada a main

## Alcance y política de tamaño

El usuario autorizó publicar la entrega acumulada de testing en main y después autorizó corregir el bloqueo artificial por tamaño. Se conserva el historial mediante avance directo, sin force-push, sin reemplazar la aplicación del colegio desde este PC y sin publicar datos operacionales, `.env`, credenciales, certificados, respaldos o evidencia privada.

Referencias al iniciar: main `af3a0635fc39d83adf95a1e1e1b0c2398b8d79ed`; testing `15d2dc246d933cadf976f11c8d559dc8f21b7c7c`. Main es ancestro de testing. La versión definitiva se identifica con `git rev-parse HEAD` y la referencia remota, no con estos hashes históricos.

El control registra 2231 KiB de JavaScript y 518 KiB de CSS; la carga inicial es 165 KiB de JavaScript y 61 KiB de CSS comprimidos. Los límites anteriores eran referencias internas, no una demostración de lentitud o error funcional. Los excesos generan aviso y no impiden construir. No se redujeron esos tamaños ni se retiraron funciones en esta corrección. Sigue fallando un build inexistente o la inclusión accidental de herramientas diferidas en el arranque. Seguridad, lint y pruebas continúan obligatorios en Docker y CI.

## Correcciones incluidas

- Alta manual: curso/motivo visibles encima del formulario, placeholders, curso de origen, Escape y recuperación sin borrar los campos. La matrícula ficticia guardada conserva curso, motivo y auditoría después de recargar y consultar PostgreSQL.
- Dependencias: axios 1.20.0, brace-expansion 5.0.12, ip-address 10.7.3 y Wrangler 4.147.0. Auditoría frontend rechaza errores de conexión o informes incompletos; no usa una aprobación falsa en modo offline.
- Contraste del avatar de iniciales en tema oscuro, sin modificar las fotos.
- PDF: cantidades enteras únicas en el eje, etiquetas legibles y resumen de intervención sin una continuación huérfana. PDF/Excel conserva el período y filtros de la respuesta visible.
- Prueba de motivos entre interfaz, servidor y esquema en `scripts/test/manual-student-contract.test.cjs`, ejecutada explícitamente en CI. El frontend no intenta leer archivos ajenos a su contexto Docker y no se omite la prueba.
- Herramientas de cuestionarios actualizadas dentro de Wrangler 4, con Node 22 en su trabajo de CI; sin despliegue, login ni migración Cloudflare. [Release oficial del proveedor](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.147.0).

## Evidencia local nueva

| Control | Resultado |
| --- | --- |
| Docker frontend completo, Node 22 | Auditoría, lint, 162 pruebas, build y medición informativa aprobados |
| Docker backend | Construcción aprobada; cobertura ejecutada dentro de la imagen, 291/291 |
| Backend Windows, ejecución secuencial con cobertura | 291/291; umbrales aprobados |
| Contrato completo de motivos de matrícula | 1/1, sin omisiones |
| Cuestionarios | npm ci normal, siete pruebas, Wrangler 4.147.0 y auditoría en línea: cero conocidas |
| Regresión focalizada sobre los fallos anteriores | 10/10 en escritorio y móvil emulado |
| Regresión general contra la imagen final | 118/118, sin reintentos; quince suites en escritorio y móvil emulado |
| Actualizador Windows | PS5.1: HTTP/HTTPS heredado, respaldo faltante, cookie incompatible y hook ajeno aprobados en fixtures; salud HTTP/API real y puerto inaccesible comprobados en QA |

Evidencia ignorada en `output/audit-fixes-20261004/`: `frontend-image-20261005.log`, `backend-container-coverage.log`, `backend-serial-20261005.log`, `focused.log`, `core.log` y reportes de navegador. El sufijo de los archivos identifica la ejecución, no sustituye la fecha del cliente ni la referencia Git.

La imagen frontend se probó con el backend y PostgreSQL QA aislados en `127.0.0.1:4174`. No se reinició ni reemplazó el servicio habitual de localhost ni se usaron datos del colegio. Los tests UI distinguen respuestas interceptadas y operaciones reales; móvil significa emulación, no dispositivo físico.

La última comprobación manual en navegador sobre esa imagen abrió el alta desde Primero Medio: el curso quedó seleccionado y las listas de cursos y seis motivos se mostraron por encima del formulario. Se inspeccionaron ambas capturas; no se envió una nueva matrícula en esta comprobación. Las capturas están ignoradas en `output/playwright/audit-20261004/manual-course-final.png` y `manual-reasons-final.png`.

Un intento de navegador apuntaba a un dist regenerado con `localhost:5000`; se invalidó por su configuración y se reconstruyó con `/api` antes de repetir. Un primer test Docker reveló la dependencia incorrecta del test frontend respecto de archivos backend; se corrigió su ubicación y se repitió toda la construcción, sin skips. Un intento de cobertura Windows tuvo un fallo de proceso en el archivo de chat; la suite aislada 20/20, la repetición secuencial 291/291 y la ejecución paralela dentro de Node 20 Docker aprobaron. No se presenta ese intento fallido como una aprobación ni se atribuye una causa no comprobada.

## CI y límites de aceptación

La última ejecución remota anterior, [36954894082](https://github.com/Lucas23-IECI/ProgramaInasistenciasColegioDomingoSantamaria/actions/runs/36954894082), no inició sus cinco trabajos: GitHub informó bloqueo de cuenta por facturación. No se modificó la cuenta ni se gastó dinero. Eso no acredita pruebas remotas aprobadas; una ejecución posterior debe consultarse por su hash y resultado efectivo. Las comprobaciones locales anteriores no se convierten en una aprobación remota.

La publicación del código no instala esta versión en el colegio. El backup previo, migraciones al arrancar, construcción y verificación pertenecen al actualizador que se ejecuta allí. No hay garantía de recuperación automática de imágenes si falla un arranque; ante error hay que detenerse, conservar el respaldo y contactar con soporte. Nunca usar `docker compose down -v`, reinicializar Git, forzar un pull ni regenerar `.env`.

## Primera actualización y siguientes

Consultar el procedimiento vigente en [Aceptación y actualización con Andrés](ACEPTACION_COLEGIO_ANDRES.md). El instalador inicial, la preparación HTTPS y el hook opcional son mecanismos distintos. Git no distribuye hooks y un pull sin cambios no ejecuta post-merge; no prometer que descargar archivos equivale a reconstruir los contenedores.

Se mantiene la dirección y el modo HTTP/HTTPS existentes. HTTPS confiable se prepara por separado y requiere confianza en los PC clientes; una actualización normal no lo instala silenciosamente ni modifica contraseñas.

El arnés reutilizable `scripts/test/update-harness.ps1` usa comandos Docker/curl simulados en un clon temporal, no instala ni actualiza los servicios habituales. No acredita por sí solo TLS físico del colegio ni el modo gestionado completo; las pruebas reales anteriores de HTTPS gestionado están en `PRUEBAS_HTTPS_2026-09-24.md`. La comprobación HTTP independiente extrae únicamente la función de salud y consulta la API/PostgreSQL QA reales, sin ejecutar el actualizador sobre esta copia.
