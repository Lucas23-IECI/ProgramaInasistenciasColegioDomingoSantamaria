# Validación local integral — 27 de agosto de 2026

## Dictamen

El conjunto integrado localmente funciona sobre el stack Docker real y supera las comprobaciones estáticas, unitarias, de interfaz, accesibilidad, compilación, rendimiento, dependencias, respaldo y restauración que se pueden ejecutar en este equipo.

Esto valida el código y la instalación local. No autoriza todavía declarar el servidor del colegio listo para producción: `scripts/verificar-produccion.ps1` conserva 12 controles de configuración e infraestructura pendientes, descritos al final de este documento.

No se realizó commit, push, merge ni despliegue.

## Revalidación posterior

El primer intento de la suite E2E fue interrumpido porque Docker Desktop se cerró durante la ejecución. La causa no fue un error de la aplicación. Tras iniciar nuevamente el motor y esperar salud de los cuatro servicios, se repitieron los 40 casos con un worker: **37 pasaron, 3 se omitieron por viewport de forma prevista y 0 fallaron**. El caso de Analítica que había quedado inestable fue corregido en el test para seleccionar explícitamente el panel “Atrasos por curso”; escritorio y móvil pasan.

La verificación de Documentos volvió a ejecutarse sobre Docker y aprobó autenticación, permisos, carga, versiones, OCR, revisión humana, firma, PDF de plantilla, descarga y limpieza. No quedaron documentos temporales ni registros de prueba.

## Evidencia aprobada

| Capa | Comprobación | Resultado |
| --- | --- | --- |
| Backend | `npm run check` | Sintaxis de núcleo, rutas, servicios y scripts aprobada. |
| Backend | `npm test` | 190 de 190 pruebas aprobadas; 0 fallos. |
| Frontend | `npm run lint` | ESLint aprobado sin errores. |
| Frontend | `npm test` | 78 de 78 pruebas aprobadas; 0 fallos. |
| Frontend | `npm run build` | Build de producción Vite aprobado. |
| Rendimiento | `npm run test:performance` | Todos los presupuestos aprobados. |
| Dependencias | Backend y frontend | 0 vulnerabilidades altas o críticas detectadas. |
| Docker | `docker compose up -d --build --wait` | PostgreSQL, backend, frontend y respaldos saludables. |
| API | `GET /api/health` | HTTP 200; servicio `OK`; base de datos `ready`. |
| Migraciones | Arranque y restauración | 48 migraciones registradas, incluidas 042 a 048. |
| Navegador | `npm run test:e2e -- --workers=1` | 37 recorridos aprobados; 3 omisiones previstas por viewport; 0 fallos. |
| Analítica | Escritorio y Pixel 7 | Línea, barras, tabla, cantidades, foco/teclado, tooltip, responsive y PDF real aprobados. |
| Accesibilidad | Flujos críticos | Sin infracciones Axe serias o críticas en las superficies comprobadas. |
| Respaldo | `scripts/respaldo-ahora.ps1` | Base, documentos y manifiesto generados y verificados. |
| Restauración | `scripts/probar-restauracion.ps1` | Restauración aislada aprobada, conteos coincidentes, backend temporal saludable y entorno eliminado. |
| Estado | `scripts/estado.ps1` | Servicios, aplicación y respaldo saludables. |

Total automatizado de la ronda final: **305 comprobaciones aprobadas** (268 Node y 37 recorridos Playwright), además de compilación, lint, auditorías, salud Docker, respaldo y restauración.

## PDF institucional

Se validó un informe ficticio filtrado con 28 días, indicadores, alertas, bloques y metodología.

- Formato A4 y metadatos institucionales correctos.
- Dos páginas con contenido; ninguna página vacía.
- Encabezados y pies repetidos sin generar páginas adicionales.
- Gráfico vectorial con valores visibles.
- Tablas paginadas sin títulos cortados ni columnas fuera de página.
- Texto extraíble y firma PDF válida.
- Prueba automatizada que rechaza una cantidad anómala de páginas.

La inspección visual se realizó sobre cada página renderizada. La muestra utiliza solamente datos ficticios.

## Presupuesto de rendimiento observado

| Métrica | Resultado | Límite | Estado |
| --- | ---: | ---: | --- |
| Script individual más grande | 482 KB | 550 KB | Aprobado |
| JavaScript total diferido | 2082 KB | 2085 KB | Aprobado |
| CSS total | 445 KB | 448 KB | Aprobado |
| JavaScript inicial | 510 KB | 520 KB | Aprobado |
| CSS inicial | 342 KB | 380 KB | Aprobado |
| JavaScript inicial gzip | 163 KB | 175 KB | Aprobado |
| CSS inicial gzip | 58 KB | 70 KB | Aprobado |

El techo de JavaScript diferido aumentó de 2050 KB a 2060 KB para cubrir la interacción línea/barras del módulo cargado bajo demanda. Los límites de carga inicial, compresión y archivo mayor no fueron relajados.

## Controles que todavía impiden declarar producción

La aplicación local está saludable, pero el verificador de producción informa 12 pendientes:

1. `NODE_ENV=production`.
2. Validación estricta de variables habilitada.
3. Cookie segura habilitada.
4. Contraseña PostgreSQL robusta.
5. Origen HTTPS institucional explícito.
6. Autoridad pública de confianza disponible para los equipos cliente.
7. Nombre o IP institucional declarados.
8. Certificado regenerado para esa identidad vigente.
9. CORS alineado con la identidad HTTPS.
10. URL HTTPS validable sin omitir controles TLS.
11. Servicio Docker configurado para inicio automático y activo sin depender de una sesión interactiva.
12. Cifrado de disco comprobado con permisos administrativos.

Hasta resolver esos controles, el estado correcto es: **código y stack local validados; configuración del servidor para producción pendiente**.
