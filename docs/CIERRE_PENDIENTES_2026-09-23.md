# Cierre de los cinco pendientes técnicos — 23 de septiembre de 2026

Continuación del [cierre inicial de sesión, operación y Recursos](CIERRE_LOCAL_2026-09-23.md). No incorpora funcionalidades externas, no autoriza publicación y no equivale a una certificación de ausencia absoluta de bugs.

**Cierre técnico local completado:** última ejecución de 172 casos, 169 aprobados, 3 omisiones expresas, 0 fallos y 0 casos intermitentes; 18/18 comprobaciones adicionales en `localhost`. Los cinco pendientes de este bloque quedan cerrados dentro del alcance probado.

## Alcance y cambios

| Pendiente | Trabajo realizado |
| --- | --- |
| PWA con caché real | Dos escenarios por dispositivo con service worker habilitado: pérdida y recuperación de red; actualización confirmada conservando IndexedDB. El test comprueba primero que el worker servido coincide con el código local. |
| Importar y revertir desde la interfaz | Excel ficticio → previsualizar → confirmar → consultar historial → previsualizar reversión → motivo y confirmación → revertir → comprobar trazas y bloqueo de segunda reversión. Dos escenarios por dispositivo: dos altas sin usuario ERP y un rechazo parcial por usuario duplicado. |
| Cobertura y CI | Control de mínimos compatible con Node 20, también probado con una ejecución deliberadamente insuficiente que devuelve código 1. CI incluye `testing`, instala Chromium, usa un puerto aislado y conserva artefactos incluso cuando aprueba. |
| Regresión unificada | Última ejecución completa sobre las imágenes finales: 169 aprobados, 3 omitidos, 0 fallos y 0 casos intermitentes. Incluye dos nuevos casos de título documental largo. |
| Documentación vigente | Estado técnico separado de planes antiguos. El tracker enlaza la evidencia actual y conserva las rondas anteriores como historial. |

### Fallos encontrados y corregidos, no solamente pruebas añadidas

- **Importación sin nombre de usuario:** se inventaba un usuario combinando inicial y apellido. Dos estudiantes distintos podían colisionar. Ahora el campo ERP opcional queda vacío si no se proporciona; una actualización vacía conserva el usuario existente.
- **Resumen de importación:** una fila revertida a su savepoint podía dejar contadores incrementados. Se restauran contadores y advertencias de esa fila antes de informar el rechazo.
- **Causas de rechazo:** los errores SQL de filas ya no se devuelven directamente ni se guardan como explicación pública. Se proporciona una causa comprensible; los detalles técnicos permanecen en el log del servidor.
- **Resultado parcial:** ya no se presenta como éxito total ni se oculta al volver automáticamente al listado. Se muestran el resultado guardado y las filas rechazadas. El resumen previo se oculta tras guardar y la tabla se identifica como previsualización, no como resultado definitivo. El aviso se dispone verticalmente, también en móvil.
- **Cachés de la PWA:** la activación eliminaba cachés ajenas del mismo origen y el fallback podía leer contenido de ellas. Ahora solo administra y consulta su propia caché `ldsm-shell-*`; las respuestas `/api/` no se almacenan.
- **Contraste en cierre de tareas:** el aviso de validación tenía una relación insuficiente detectada por la prueba de accesibilidad. Se ajustó su color y se volvió a comprobar en navegador.
- **Fixture de tareas:** la prueba de iniciar una tarea ya no queda omitida en QA por depender de un ID manual. Crea y completa su propia tarea ficticia en la base aislada.
- **Documentos con títulos largos:** la segunda ronda detectó desbordamiento horizontal de 9 px en escritorio. La etiqueta accesible oculta de la columna Acciones estaba posicionada fuera del contexto de la tabla desplazable. El contenedor ahora ancla sus elementos posicionados; se incorpora un caso determinista con un título largo, comprobado antes del arreglo para demostrar que reproduce el fallo.

## Entorno y límites de los datos

- QA real: `http://127.0.0.1:8082`, base `ldsm_codex_manual_019ffb95`, archivos en `ldsm_codex_manual_uploads`.
- Las pruebas de importación exigen habilitación explícita y un puerto local distinto de 80. Cada archivo y sus estudiantes tienen identificadores ficticios únicos. Solo se revierten las importaciones creadas por el propio test.
- El proxy efímero de PWA pasa las peticiones al servidor real; solo alterna los bytes de `/sw.js` para reproducir el ciclo de actualización. No simula respuestas de negocio.
- Los tests de sesión y errores también usan respuestas controladas para provocar carreras, 401/409/500/503 y respuestas retrasadas. Eso valida la interfaz, no se presenta como persistencia real.
- Escritorio es Chrome; móvil es emulación Pixel 7. No se afirma haber probado dispositivos físicos en esta ronda.
- Los contenedores QA sustituidos se conservaron detenidos. No se eliminaron bases ni volúmenes.

## Pruebas y evidencia

| Comprobación | Resultado |
| --- | --- |
| Backend en Node 20, unitarias/contratos y cobertura | 270 aprobadas; 0 fallos. Líneas 81,76 %, ramas 77,45 %, funciones 89,22 %. |
| Rechazo efectivo por cobertura insuficiente | Código de salida 1: funciones 45,24 % frente a mínimo 80 %. Es un fallo deliberado que comprueba el control. |
| Frontend, unitarias/contratos y cobertura | 149 aprobadas; 0 fallos. Líneas 88,86 %, ramas 82,08 %, funciones 86,42 %. |
| Lint y compilación Docker de frontend | Aprobados, incluyendo la revisión visual final de importación. |
| Construcción Docker backend y sintaxis | Aprobadas. |
| Presupuesto frontend final | Aprobado: JavaScript 2184 KiB; gzip 644 KiB; CSS 494 KiB. No se amplió el presupuesto en este cierre de pendientes. |
| Auditoría de dependencias | Sin vulnerabilidades reportadas en la ronda; control de frontend sin avisos altos/críticos en la última construcción. |
| Primera regresión unificada | 170 casos: 167 aprobados, 3 omitidos, 0 fallos, 0 intermitentes, sin reintentos. |
| Repetición tras ajuste visual | 165 aprobadas, 3 omitidas y 2 fallidas por el desbordamiento de Documentos en escritorio; no se considera aprobada. |
| Caso determinista de título largo, antes/después | Antes: falla escritorio y pasa móvil. Después: 2/2 aprobados sobre la nueva imagen. |
| Última regresión de 172 casos | **169 aprobados, 3 omitidos, 0 fallos, 0 intermitentes; sin reintentos; 10,7 minutos.** |

La cobertura corresponde a los archivos instrumentados por el ejecutor Node, no a toda la aplicación ni a todos los componentes React. El navegador aporta comprobaciones adicionales de interacción, persistencia, visualización y accesibilidad.

### Tres omisiones expresas de la ronda unificada

1. Una comprobación exclusiva de ancho móvil de justificaciones se omite en escritorio y se ejecuta en móvil.
2. Una comprobación exclusiva de ancho móvil del flujo crítico se omite en escritorio y se ejecuta en móvil.
3. La escritura del perfil se omite en móvil; se comprueba y restaura en escritorio.

No se suman repeticiones como si fueran casos distintos. No hay omisiones por falta de importaciones preexistentes ni por falta de ID de tarea en esta ejecución QA.

### Artefactos locales

- [Informe navegable final, 169 aprobados](../frontend/output/cierre-20260923/verificado-reporte/index.html).
- [Resultado estructurado final](../frontend/output/cierre-20260923/verificado-results.json).
- [Resultado estructurado de la primera ronda unificada](../frontend/output/cierre-20260923/unificado-results.json).
- [Informe navegable de la primera ronda](../frontend/output/cierre-20260923/unificado-reporte/index.html).
- [Cobertura backend en Node 20](../frontend/output/cierre-20260923/backend-node20-coverage.log).
- [Cobertura frontend](../frontend/output/cierre-20260923/frontend-coverage.log).
- [Control negativo de cobertura](../frontend/output/cierre-20260923/cobertura-rechazo-esperado.log).
- [Construcción final de frontend](../frontend/output/cierre-20260923/build-frontend-final.log).
- [Conteos de la base principal antes de actualizar](../frontend/output/cierre-20260923/principal-antes.log).
- [Integridad antes de actualizar](../frontend/output/cierre-20260923/integridad-antes.log).

Los artefactos están ignorados por Git porque son generados y pueden contener datos de pruebas locales. Los informes iniciales con fallos se conservan (`pendientes-focused.json`, `pendientes-retest.json`, `definitivo-results.json` y las trazas en `documentos-antes-fix`), no se reescriben como si hubieran aprobado desde el comienzo.

## Reproducción

Sobre la QA aislada ya levantada, con las credenciales locales configuradas en `.env`:

```powershell
cd frontend
$env:E2E_BASE_URL = 'http://127.0.0.1:8082'
$env:E2E_ISOLATED_MUTATIONS = '1'
$env:E2E_AUDIT_RUN = 'cierre-20260923-verificado'
$env:PLAYWRIGHT_HTML_OUTPUT_DIR = 'output/cierre-20260923/verificado-reporte'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'output/cierre-20260923/verificado-results.json'
$env:PLAYWRIGHT_HTML_OPEN = 'never'
npx --no-install playwright test --workers=1 --reporter=list,json,html --output output/cierre-20260923/verificado
```

No ejecutar las mutaciones de esta suite contra la base del colegio ni habilitarlas solo cambiando el puerto de una instalación con datos reales.

## Instalación habitual, Git y límites restantes

Se recrearon únicamente backend y frontend de `localhost`; PostgreSQL y respaldos continuaron activos. Los cuatro servicios principales están saludables. No se añadieron migraciones en este cierre: las 53 ya estaban aplicadas.

| Registros principales | Antes | Después |
| --- | ---: | ---: |
| Estudiantes | 404 | 404 |
| Ingresos registrados | 158 | 158 |
| Visitas | 43 | 43 |
| Retiros | 8 | 8 |
| Usuarios | 12 | 12 |
| Documentos de respaldo | 6 | 6 |
| Migraciones | 53 | 53 |

El control de integridad posterior verifica los 6 archivos sin faltantes y nueve controles relacionales sin inconsistencias. Estos conteos no equivalen a comparar toda la base byte por byte. Evidencias: [conteos posteriores](../frontend/output/cierre-20260923/principal-despues.log) e [integridad posterior](../frontend/output/cierre-20260923/integridad-despues.log).

Las imágenes finales compartidas por QA y `localhost` son:

- Backend: `sha256:989a8de3fd4abc8fc65503cc26c29b7ea29d933330e520cbce77de06501d91ff`.
- Frontend: `sha256:e9329f851b9e175307f58b8dedf014da6db9fa1c7243bacb035d6fb7050269e9`.

La comprobación final de navegador en `localhost` aprobó **18/18**, sin omisiones: sesión, ayuda y modal de Recursos, tabla documental con título largo, actualización PWA y pérdida/recuperación de conexión. No guarda registros escolares. [Resultado](../frontend/output/cierre-20260923/local-verificado-results.json) e [informe](../frontend/output/cierre-20260923/local-verificado-reporte/index.html).

Además se hizo una comprobación manual en el navegador integrado contra QA: apareció la actualización pendiente, se pulsó Actualizar ahora y Documentos conservó la sesión y la ruta. Se abrió Nueva plantilla, se escribió un nombre, Tab pasó correctamente a Categoría, se inspeccionó el fondo de viewport completo y Escape cerró sin guardar, devolviendo el foco a Nueva plantilla. La captura y los pasos se observaron en la sesión de trabajo; no se cuentan como casos adicionales de la suite.

La CI está preparada pero **no se ha ejecutado en GitHub** en esta solicitud: no se ha realizado push. Su entorno recién sembrado no ejecuta todas las mutaciones QA locales; habilita las importaciones autocontenidas, mientras otras pruebas requieren fixtures aislados específicos.

No quedan fallos abiertos de los escenarios ejecutados en este bloque. Esto no sustituye pruebas de dispositivos físicos ni implica que la CI remota haya sido ejecutada. Permanece el aviso informativo de Vite sobre un chunk de más de 500 kB y el aviso de configuración de contraseña local de base de datos corta. No se rotaron credenciales ni se modificó la instalación del colegio.

Rama local `testing`, base `c6ac038`. Sin commits ni push por este cierre. No se afirma nada sobre cambios remotos nuevos sin consultar el remoto.
