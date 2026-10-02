# Cierre local de sesión, operación y recursos — 23 de septiembre de 2026

> Evidencia de la ronda inicial del día. Los cinco pendientes posteriores y la ronda unificada están en [cierre de pendientes](CIERRE_PENDIENTES_2026-09-23.md). Las cifras y omisiones de abajo se conservan como historial, no como el último resultado.

## Alcance

Revisión de los problemas pendientes reportados por Lucas: navegación tras iniciar sesión, múltiples pestañas, errores ocultos detrás de modales, tareas internas y formularios de Recursos. Incluye regresión transversal de los módulos existentes. No agrega módulos, no publica al colegio y no realiza commits ni push.

El código de partida es `testing`, `c6ac038`, más el trabajo local existente. Las correcciones descritas aquí continúan sin commit.

## Correcciones de esta ronda

| Área | Problema verificado | Corrección y comprobación |
| --- | --- | --- |
| Sesión | Recuperar el foco mientras el cierre seguía en tránsito podía restaurar una sesión que la persona acababa de cerrar. | El cierre explícito invalida respuestas anteriores y no permite restauración automática. Prueba con respuesta de logout retenida. |
| Pestañas | Una respuesta 401 de una comprobación antigua podía borrar un acceso realizado en otra pestaña. | Se invalidan comprobaciones por versión de sesión y de consulta. Prueba con dos pestañas y respuestas fuera de orden. |
| Login | Un fallo temporal de verificación podía mostrar el formulario de acceso como si la sesión estuviera cerrada. | Estado recuperable con reintento; prueba con 503 y posterior recuperación. |
| Destino protegido | El cambio obligatorio de contraseña perdía el módulo solicitado. | Conserva ruta y filtros internos seguros. Prueba simulada sin modificar contraseñas reales. |
| Confirmaciones globales | El foco podía volver a un botón desmontado al cerrar una confirmación. | Captura del control original, recorrido Tab/Shift+Tab, Escape y restauración del desplazamiento. |
| Operación | Escape podía cerrar el formulario mientras se confirmaba el guardado. | Bloqueo durante la solicitud. El motivo inválido aparece dentro del formulario y recibe foco. |
| Documentos | Escribir podía devolver el foco al cierre del modal por recreación de su callback. | Ciclo de foco estable; prueba escribiendo carácter por carácter, guardando y descargando un PDF real. |
| Recursos | El nombre accesible de Categoría incluía la explicación completa; enviar el formulario reiniciaba el ciclo de foco. | Etiqueta y ayuda separadas; conserva campos y foco tras error. |
| Recursos, presentación | La explicación de Categoría estiraba Código interno. | Campos alineados, altura comprobada en navegador e inspección visual. |
| Verificación | Los reportes generados se analizaban como código fuente en lint y en la revisión de tildes. | Se excluye únicamente `output`, como ya se excluyen los otros directorios de resultados. |
| Compilación local | El proyecto está accedido mediante una unión de directorios de Windows. | Vite resuelve la raíz desde su archivo de configuración. Compilación local y Docker verificadas. |
| Dependencias | La auditoría actual detectó avisos en Sharp y qs. | Sharp 0.35.4 y resolución actualizada de qs. Auditoría posterior sin vulnerabilidades reportadas. |

Las correcciones anteriores de retorno desde login, portales de modales/avisos, categorías sugeridas y SQL de tareas se conservaron y se volvieron a ejercitar. No se atribuyen como nuevas a esta ronda.

## Entorno y protección de datos

- Pruebas con escrituras: `http://127.0.0.1:8082`, backend aislado y base `ldsm_codex_manual_019ffb95`.
- Archivos de prueba: volumen separado `ldsm_codex_manual_uploads`.
- La suite de mutaciones exige una habilitación explícita y un puerto local distinto de 80.
- Los registros creados para comprobar flujos quedan identificados como pruebas en la base aislada, no en la base principal.
- El volumen aislado tenía su directorio raíz sin permisos para el usuario del contenedor. Se corrigió solamente ese directorio. El volumen principal ya permitía escritura.
- No se eliminaron bases, volúmenes ni documentos del usuario. Los contenedores QA sustituidos se conservaron detenidos.

## Resultados comprobados

| Comprobación | Resultado |
| --- | --- |
| Backend, pruebas unitarias/contratos | 266 aprobadas. También ejecutadas en la construcción Docker con Node 20. |
| Frontend, pruebas unitarias/contratos | 149 aprobadas. |
| Lint frontend y sintaxis backend | Aprobados en la construcción Docker. |
| Construcción de frontend y backend | Aprobada. |
| Repetición enfocada tras las correcciones | 47 aprobadas, 3 omitidas, 0 fallos; escritorio y móvil emulado. |
| Regresión completa de 164 casos | 156 aprobados, 7 omitidos y 1 fallo de selector del test de ayuda. Corregido y repetido: 2/2 aprobados en escritorio y móvil. Resultado consolidado: 157 casos distintos aprobados y 7 omitidos, sin fallos abiertos en los casos ejecutados. |
| Verificación posterior en `http://localhost` | 12/12 aprobadas: sesión, recuperación, retorno al módulo, modal y ayuda de Recursos. Sin mutaciones de registros escolares. |
| Auditoría npm | 0 vulnerabilidades reportadas en frontend y dependencias productivas del backend, a la fecha de esta ejecución. |
| Reversión real en PostgreSQL | 1 fila reversible, 1 compensación, ficha desactivada y 1 traza; transacción descartada con ROLLBACK. |
| Integridad de la base principal, antes de actualizar los contenedores | 53 migraciones, 6 archivos comprobados, 0 faltantes y 0 inconsistencias en los nueve controles relacionales. |

Cobertura ejecutada con Node 24: backend 73,08 % de líneas, 69,17 % de ramas y 82,11 % de funciones; frontend 88,86 %, 82,08 % y 86,42 %, respectivamente. Son porcentajes de los archivos instrumentados por las pruebas Node, **no de toda la interfaz React**. La interfaz se comprueba mediante navegador. El comando de cobertura con umbrales requiere un Node más reciente que el Node 20 de la imagen backend; en esa imagen se ejecutó `npm test`, y la cobertura se midió en el runtime local compatible.

Presupuesto de la compilación local: JavaScript total 2184 KiB, inicial 502 KiB (160 KiB comprimido), CSS total 493 KiB. Se amplió únicamente el límite de JavaScript propio de 1250 a 1252 KiB para las protecciones de sesión y foco; los límites totales, iniciales y comprimidos no cambiaron. La compilación mantiene el aviso informativo de Vite sobre chunks de más de 500 kB.

## Qué se probó realmente

- Tareas: crear, iniciar, completar con motivo, volver a consultar e inspeccionar historial en el servidor real.
- Recursos: inventario, edición, solicitud, aprobación, entrega, devolución, cancelación y rechazo mediante API real; creación y préstamo desde interfaz real.
- Concurrencia: dos solicitudes de préstamo sobre una sola unidad devuelven 201 y 409; dos devoluciones del mismo préstamo devuelven 200 y 409. Stock consistente.
- Documentos: escritura consecutiva, carga, versiones, descarga y constancia de firma en QA.
- Agenda y Convivencia: ciclos de creación, consulta y cierre/cancelación con persistencia aislada.
- Sesión: acceso desde un enlace profundo, filtros, Atrás, múltiples pestañas, solicitudes retrasadas y recuperación ante fallo temporal.
- Errores de interfaz: respuestas controladas 409/500/503, retención de campos, reintento, motivo inválido y avisos por encima del fondo modal.
- Regresión transversal: analítica/exportación, búsqueda, auditoría, permisos, chat contextual, notificaciones, Portería, continuidad offline, ayudas y adaptación responsive.

El único fallo de la ronda final fue una selección ambigua de “Siguiente” cuando el inventario de QA superó una página: el test encontraba también “Página siguiente”. Se corrigió a coincidencia exacta y se repitió sobre el mismo inventario paginado. Los informes originales se conservaron; no se reescribió una ejecución fallida como si hubiera sido verde desde el comienzo.

Se combinan pruebas reales contra PostgreSQL con respuestas simuladas para provocar errores de manera determinista. No se presenta una prueba simulada como validación de persistencia.

## Revisión manual de navegador

En el navegador de la aplicación, sobre el entorno aislado:

1. Se abrió Recursos sin sesión y se inició sesión mediante el formulario: volvió a Recursos, no al panel principal.
2. Se abrió Agregar recurso y se inspeccionó el fondo completo, sin bandas laterales blancas ni herramientas globales superpuestas.
3. Se envió un código interno ya existente: el servidor devolvió el rechazo, el aviso apareció delante del modal y se conservaron los valores.
4. Se cerró el modal con Escape y se recargó: Recursos siguió abierto sin solicitar nuevamente las credenciales.
5. Se inspeccionaron visualmente los campos Categoría y Código interno tras corregir su alineación.

## Evidencia reproducible

- Informe completo: `frontend/output/cierre-20260923/final-reporte/index.html`.
- Resultado estructurado: `frontend/output/cierre-20260923/final-results.json`.
- Capturas de la ronda final: `frontend/output/cierre-20260923/final/`.
- Casos iniciales que reprodujeron fallos de sesión: `frontend/output/cierre-20260923/antes/`.
- Primera ronda transversal, con hallazgos pendientes entonces: `frontend/output/cierre-20260923/regresion/`.
- Repetición enfocada: `frontend/output/cierre-20260923/retest/`.
- Repetición de ayuda corregida: `frontend/output/cierre-20260923/ayuda-retest-results.json` y `ayuda-retest-reporte/index.html`.
- Verificación en la instalación local actualizada: `frontend/output/cierre-20260923/localhost-results.json` y `localhost-reporte/index.html`.

Los artefactos están excluidos de Git porque pueden contener información local y son resultados generados, no código fuente.

Para repetir la ronda, con el entorno aislado ya levantado y credenciales locales configuradas:

```powershell
cd frontend
$env:E2E_BASE_URL = 'http://127.0.0.1:8082'
$env:E2E_ISOLATED_MUTATIONS = '1'
$env:E2E_AUDIT_RUN = 'cierre-20260923-final'
$env:PLAYWRIGHT_HTML_OUTPUT_DIR = 'output/cierre-20260923/final-reporte'
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = 'output/cierre-20260923/final-results.json'
$env:PLAYWRIGHT_HTML_OPEN = 'never'
npx --no-install playwright test --workers 1 --reporter=list,json,html --output output/cierre-20260923/final
```

## Límites expresos

- Móvil significa emulación de Pixel 7 y verificaciones de ancho reducido, no ensayo en un teléfono físico.
- La suite funcional bloquea service workers para comprobar el código actual; no certifica todas las combinaciones de caché o de instalación PWA.
- Las pruebas de reversión desde navegador dependen de importaciones persistidas; la reversión del servicio sí se ejecutó por separado dentro de una transacción descartable.
- No se afirma ausencia absoluta de bugs ni certificación productiva universal a partir de una suite finita.
- La configuración local sigue advirtiendo sobre una contraseña de base de datos corta. No se rotaron credenciales ni se alteró la instalación del colegio.

## Cierre de ejecución

**Cerrado el bloque de errores reportados y sus regresiones comprobadas.** Los cuatro contenedores principales están saludables y `/api/health/ready` responde 200. Backend y frontend de `localhost` usan las imágenes construidas en esta ronda. No hubo nuevas migraciones al recrearlos: las 53 ya estaban aplicadas.

Conteos antes y después de la actualización local:

| Tabla | Antes | Después |
| --- | ---: | ---: |
| Estudiantes | 404 | 404 |
| Ingresos registrados | 158 | 158 |
| Visitas | 43 | 43 |
| Retiros | 8 | 8 |
| Usuarios | 12 | 12 |
| Documentos de respaldo | 6 | 6 |
| Migraciones aplicadas | 53 | 53 |

El control de integridad posterior también terminó con 0 archivos faltantes y 0 inconsistencias. Estos conteos corroboran conservación del volumen de datos; no equivalen a una comparación byte por byte de toda la base.

Las siete omisiones de navegador son explícitas:

- 2 ejecuciones de un test antiguo que requiere `E2E_OPERATION_TASK_ID`; el ciclo real completo se comprobó con las tareas creadas por `isolated-real-mutations`.
- 2 ejecuciones de previsualización de importación existente, porque QA no tenía importaciones persistidas. La compensación real del servicio se probó por separado con ROLLBACK.
- 2 casos exclusivos del viewport móvil omitidos en el proyecto escritorio.
- 1 escritura del perfil omitida en móvil para no repetir la mutación ya validada y restaurada en escritorio.

No queda una corrección abierta de los fallos reproducidos en este bloque. Esto no elimina los límites de cobertura descritos arriba ni autoriza una publicación. Git continúa en `testing`, `c6ac038`, sin commits ni push de esta ronda.
