# Cierre local de correcciones — 4 de octubre de 2026

> Decisión posterior: el usuario autorizó corregir la política de tamaño y pasar la entrega a main. El tamaño queda medido y visible como aviso, sin bloquear una instalación funcional por referencias internas. La construcción Docker frontend completa ya aprobó auditoría, lint y 162 pruebas; se separó el contrato entre frontend/backend para que se ejecute con el checkout completo. [Preparación de la publicación y actualización](PUBLICACION_MAIN_2026-10-04.md). Las afirmaciones de «sin publicar» y «peso aplazado» que siguen documentan el momento del cierre local anterior, no la decisión posterior.

## Resultado y límites de publicación

Los cuatro pendientes señalados por el usuario quedan comprobados localmente: dependencias vulnerables, contraste del avatar oscuro, exportaciones históricas y los nueve fallos de la tanda anterior. También se repitió el alta manual desde Primero Medio con guardado, recarga y comprobación en PostgreSQL.

**No es una autorización para promover a main ni instalar en el colegio.** El presupuesto total de JavaScript/CSS sigue excedido y su optimización continúa aplazada por decisión del usuario. No se elevaron los límites ni se omitió el control. No se hicieron commits, push, merge ni despliegue en esta ronda.

Referencias remotas comprobadas al cerrar:

- `testing`: `15d2dc246d933cadf976f11c8d559dc8f21b7c7c`.
- `main`: `af3a0635fc39d83adf95a1e1e1b0c2398b8d79ed`, sin cambios.
- Las nuevas correcciones de este informe permanecen en el directorio de trabajo local de `testing`, todavía sin publicar. La corrección original del alta manual ya forma parte del testing remoto.

## Alta manual: incidente de Andrés

La corrección del 1 de octubre no necesitaba motivos nuevos ni crear cursos: los menús se dibujaban detrás del formulario y el valor vacío no mostraba el placeholder. Se conserva esa corrección y la selección del curso de origen. [Causa y cambios originales](CORRECCION_ALTA_MANUAL_2026-10-01.md).

Esta vez se comprobó contra servidor y base reales, no únicamente mediante API simulada:

1. Preparar un curso Primero Medio y una matrícula ficticia exclusivamente en QA.
2. Entrar a su nómina y abrir «Agregar estudiante»: Primero Medio aparece preseleccionado.
3. Abrir curso y motivo; inspeccionar sus opciones visibles sobre el formulario. El motivo contiene las seis opciones institucionales existentes.
4. Escape cierra el desplegable y conserva el formulario.
5. Completar una matrícula ficticia y elegir «Matrícula reciente»: HTTP 201.
6. Recargar y volver a Primero Medio: el registro sigue presente.
7. Consultar PostgreSQL: matrícula en el curso esperado, motivo conservado y evento `CREAR_ALUMNO` registrado en auditoría.

Evidencia local: `output/audit-fixes-20261004/manual-student-results.json`, `andres-course-options.png`, `andres-reason-options.png` y `andres-saved-after-reload.png`.

Esto prueba la versión QA actual. No confirma que el colegio la haya instalado; no se accedió a su servidor.

## Dependencias y control de seguridad

Actualización dirigida, sin `npm audit fix --force`, sin ignorar avisos y sin actualizar indiscriminadamente dependencias:

| Dependencia | Antes | Ahora | Ubicación |
| --- | --- | --- | --- |
| axios | 1.18.1 | 1.20.0 | Frontend, directa |
| brace-expansion | 5.0.9 | 5.0.12 | Frontend, transitiva de ESLint/minimatch |
| ip-address | 10.4.0 | 10.7.3 | Backend, transitiva de express-rate-limit |

Consultas nuevas `npm audit --offline=false --json`: **cero vulnerabilidades conocidas en ambos árboles**, incluidas dependencias de desarrollo del frontend. No se reutilizó el resultado incorrecto obtenido con npm offline.

El script del frontend exige consultar el registro y rechaza interrupciones, errores de transporte, JSON roto e informes incompletos. Se añadieron cuatro regresiones unitarias. Una prueba negativa con registro local inaccesible y `npm_config_offline=true` termina en código 1; no informa una aprobación falsa.

La imagen backend nueva se construyó realmente con Node 20 y `npm ci`: sintaxis, 291 pruebas y auditoría Docker aprobadas. Imagen local dedicada: `ldsm-audit-fixes-backend:20261004`. No sustituye la imagen habitual. La receta frontend sigue bloqueada en el control de peso, aunque auditoría, lint, pruebas y build de Vite pasan; **no se declara aprobada una imagen frontend completa**.

Avisos contrastados con los mantenedores: [axios](https://github.com/axios/axios/security/advisories/GHSA-r4gj-5m52-g5wh), [brace-expansion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr) e [ip-address](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-h3mg-xc3c-68pw). Una auditoría sin avisos conocidos no garantiza ausencia absoluta de vulnerabilidades.

## Avatar en modo oscuro

El avatar de iniciales usaba letras blancas sobre un fondo claro del tema oscuro. Ahora utiliza un token de texto sobre color primario específico por tema; los selectores se limitan al avatar de iniciales y no invaden las fotos de `StaffAvatar`.

Se comprobaron las ocho pantallas críticas y los cuatro diálogos en escritorio y móvil emulado mediante axe y control de desborde. Los diez casos focalizados —incluidos chat, perfiles y analítica— pasan. Se inspeccionó la captura del avatar; los colores efectivos son `rgb(21,33,43)` sobre `rgb(185,222,243)`, contraste aproximado 11,53:1.

La revisión visual preserva el diseño, las rutas y los permisos actuales: no introduce una reorganización del sistema.

## PDF y Excel con historial representativo

Se prepararon nueve ingresos ficticios en PostgreSQL, en dos cursos, con snapshots de curso/control/regla, fechas históricas, atrasos leves/graves y justificados/no justificados. Se incluyen registros fuera de ambos extremos para detectar filtraciones de período.

Se compararon API y 18 descargas reales en nueve combinaciones:

| Caso | Ingresos esperados | Atrasos esperados |
| --- | ---: | ---: |
| Curso A, 9–13 de septiembre | 5 | 4 |
| Curso B, mismo período | 2 | 2 |
| Todos los cursos, mismo período | 7 | 6 |
| Curso A, graves sin justificar | 1 | 1 |
| Curso A, justificados | 2 | 2 |
| Curso A, leves | 2 | 2 |
| Solo primer día, 9 de septiembre | 1 | 0 |
| Solo último día, 13 de septiembre | 1 | 1 |
| Período vacío, 20–21 de septiembre | 0 | 0 |

Además, cuatro solicitudes inválidas son rechazadas: fechas invertidas y severidad inexistente, tanto en consulta como en exportación.

Comprobaciones de los archivos:

- Excel se abre mediante openpyxl y sus contadores, cursos y evolución diaria coinciden con la API. Las celdas métricas mantienen tipo numérico.
- PDF se lee con pdfplumber: período, alcance aplicado y contadores coinciden con la misma consulta; no hay páginas vacías, caracteres de sustitución ni texto fuera de los límites físicos de la página.
- Se renderizaron y revisaron las tres páginas del informe del curso A. Se detectó y corrigió un defecto adicional del gráfico: cantidades pequeñas generaban etiquetas repetidas del eje. Ahora usa ticks enteros únicos y las etiquetas de los puntos no se pisan con los marcadores.
- El resumen pequeño de seis indicadores de intervención conserva título y filas en una misma página, sin una fila de continuación aislada.
- Nueva regresión backend para escalas de 0, 1, 2, 3, 4, 5, 8, 13 y 997 atrasos.
- La prueba UI de exportación ahora compara las fechas del archivo con el período de la respuesta visible y conserva curso, justificación y severidad en PDF y Excel. La repetición final pasa en escritorio y móvil.

Evidencia: `output/audit-fixes-20261004/exports-results.json`, `inspection-results.json`, los nueve pares PDF/XLSX y las imágenes `course-a-page-1.png` a `course-a-page-3.png`.

No se usaron datos privados del colegio. No se afirma apertura en Microsoft Excel físico, impresión en papel ni inspección visual de todas las páginas de todos los archivos: se distingue la validación estructural de los nueve PDFs de la revisión visual de las tres páginas representativas.

## Pruebas finales, sin reintentos

| Tanda | Resultado | Log local |
| --- | --- | --- |
| Frontend y cobertura | 159/159; líneas 89,07%, ramas 83,28%, funciones 87,06% | `frontend-tests.log` |
| Backend y cobertura | 291/291; líneas 71,27%, ramas 70,03%, funciones 80,20% | `backend-tests.log` |
| Focalizada sobre los fallos anteriores | 10/10 | `focused.log` |
| Regresión general: 15 suites | 118/118 | `core.log` |
| Complementaria: 7 suites | 59 aprobadas, 3 omisiones previstas, 0 fallos | `remaining.log` |
| Chat: 7 suites de presentación e interacción | 144/144 | `chat.log` |
| Chat con cuatro sesiones HTTP y PostgreSQL | 19/19 | `chat-real.log` |
| Regresión adicional de exportaciones UI con filtros exactos | 2/2 | `analytics.log` |
| ESLint y build Vite de producción | Aprobados | `lint.log`, `build.log` |
| Imagen backend nueva | Aprobada | `backend-image.log` |
| Auditoría en línea, frontend/backend | 0 conocidas / 0 conocidas | `frontend-audit-json.log`, `backend-audit.log` |
| Auditoría contra registro inaccesible | Rechazo esperado; código 1 | `audit-unavailable.log` |
| Peso de frontend | Fallan cinco métricas totales; carga inicial aprobada | `performance.log` |

Los logs están en `output/audit-fixes-20261004/`, ignorado por Git. Las tandas se solapan: los anuncios del chat se repiten en dos grupos, y las pruebas focalizadas/analíticas son subconjuntos. **No se suman como cientos de casos distintos.**

Las tres omisiones complementarias son específicas del dispositivo: dos pruebas de ancho móvil omitidas en escritorio y una edición/restauración del perfil propio omitida en móvil. No son fallos ni se cuentan como aprobaciones.

Los nueve fallos anteriores no se ocultaron desactivando pruebas. Se corrigió el contraste real; los tests de chat usan el nombre accesible vigente; el test de perfil vinculado usa una cuenta que sí existe en la instalación inicial; analítica tiene registros históricos completos. Todas esas comprobaciones pasan en las nuevas ejecuciones.

## Entorno y pruebas invalidadas

- Solo contenedores QA `ldsm_release_audit_20261004_*`, base `ldsm_codex_manual_019ffb95`, red dedicada y loopback `127.0.0.1:4174`. No se reemplazó ni reinició `localhost:80`.
- El frontend QA sirve el build actual con `VITE_API_URL=/api`. Un primer intento apuntó al puerto habitual 5000; la política CSP lo rechazó. Esa tanda se invalidó, se reconstruyó con el destino correcto y se repitió. No cuenta como aprobación ni como fallo funcional del producto.
- El backend QA conserva sus datos/adjuntos aislados; se copiaron la dependencia corregida, el lockfile y el generador PDF actual y se reinició únicamente ese backend. La imagen nueva se construyó por separado; no se confunden ambas comprobaciones.
- Los scripts de fixtures necesitaron corregir conversiones SQL del helper. Sus errores no se presentan como defectos de la aplicación; solo se aceptan los resultados posteriores completos.
- Los recorridos UI distinguen API real, HTTP/SQL reales y respuestas interceptadas. Los tests de presentación del chat y errores inyectados no certifican persistencia; las comprobaciones HTTP y de mutaciones reales aportan esa evidencia.
- Móvil significa emulación de navegador, no teléfono físico ni teclado virtual real.
- La revisión independiente mediante subagentes no pudo iniciarse por límite de uso; no se cuenta como auditoría realizada.
- CI remota no se ejecutó en esta ronda. La anotación histórica de bloqueo de cuenta no se revalidó ni se modificó.

## Pendiente vigente

JavaScript total 2231/2188 KiB, gzip 658/650, JS propio 1298/1255, gzip propio 385/380 y CSS 518/495. El aumento pequeño respecto de la medición previa incluye la dependencia axios corregida. Los límites de carga inicial y del mayor archivo siguen aprobados.

La optimización queda para la siguiente tarea cuando el usuario lo indique. Antes de promover a main se necesita superar o decidir expresamente ese control y repetir la receta Docker frontend completa; esta ronda no autoriza saltarlo. Los cuatro pendientes funcionales/de seguridad mencionados por el usuario ya no quedan abiertos dentro del alcance probado.
