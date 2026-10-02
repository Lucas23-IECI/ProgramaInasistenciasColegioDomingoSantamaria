# Alta manual: selectores, curso de origen y recuperación — 1 de octubre de 2026

## Resultado

Corrección local del incidente comunicado por Andrés el 30 de septiembre. Se revisaron la captura y el video recibido, sin incorporar sus datos personales a las pruebas ni a este informe. Permanece en `testing`, sobre `c6ac038`, junto a los cambios anteriores; no hay commit, push ni despliegue de esta ronda.

El flujo corregido supera la regresión de navegador descrita abajo. **No se declara lista para publicar toda la actualización:** el control de tamaño del frontend sigue fallando. Tampoco se comprobó esta corrección contra la instalación del colegio.

## Causas y correcciones

1. **Opciones tapadas por el formulario.** En el código de HEAD, el menú usa una capa 15000 y el formulario 20000. Al reproducir esa combinación en Chrome, las seis opciones existen en el DOM pero quedan ocultas detrás del formulario, como en el video. Se conserva la escala global que ya estaba en los cambios locales y se asegura el selector en 21000. No se conoce el hash exacto del frontend servido en el colegio.
2. **Texto inicial vacío.** El selector convertía el valor vacío a una opción interna inexistente en campos obligatorios. Ahora muestra «Seleccionar curso/motivo/país», manteniendo la opción vacía explícita de los filtros.
3. **Curso de origen perdido.** El alta no recibía el curso seleccionado. Ahora recibe únicamente un curso real del catálogo; «Matrícula completa» y agrupaciones sin curso no se convierten en cursos nuevos. En navegador apareció además un cambio vacío emitido por el select nativo auxiliar de Radix al sincronizar el valor inicial: se ignora, conservando las selecciones explícitas.
4. **Escape y datos escritos.** Escape dentro del menú cierra solamente ese menú. La inicialización del formulario se separó del control de cierre para que una recarga del catálogo no borre nombres ni otros campos.
5. **Errores de carga silenciosos.** Un fallo o una respuesta inválida de padrón/cursos muestra un aviso y reintento. La carga lenta y un catálogo realmente vacío bloquean el guardado incompleto, sin inventar cursos. Un error de guardado conserva los datos para reintentar.
6. **Legibilidad.** El formulario usa una superficie opaca en ambos temas: no se transparenta el texto del padrón situado detrás.
7. **Ayuda y anuncio.** El recorrido de estudiantes explica curso, motivo, reintento y Escape. La corrección es el primer elemento de las novedades para cuentas con gestión de estudiantes. La versión del anuncio y del service worker coincide: `2026.10.01-alta-manual-chat-v1`.

No se cambiaron los seis motivos aceptados por el servidor, el esquema, los permisos ni los registros existentes. Esta corrección no requiere una migración nueva; los demás cambios acumulados sí contienen migraciones previas y no quedan autorizados para desplegar por este informe.

## Evidencia de esta ronda

Directorio local de resultados: `output/playwright/student-manual-20260930/`. No se suman las repeticiones de un mismo recorrido como pruebas distintas.

| Verificación | Resultado | Archivo |
| --- | --- | --- |
| Frontend: suite Node completa, unidades y contratos de código | 155/155 | `frontend-unit.log` |
| Backend: suite Node completa, unidades y contratos; sin servidor/PostgreSQL real | 290/290 | `backend-unit.log` |
| Navegador Chrome sobre el frontend fuente | 47 comprobaciones aprobadas | `browser-regression.log` |
| Misma regresión sobre el build de producción, servido en loopback | 47 comprobaciones aprobadas | `browser-production-build.log` |
| Ayuda y novedades reales de la UI, escritorio y ancho móvil, sobre el build | 8/8 | `help-release.log` |
| ESLint | Aprobado | `lint.log` |
| Build de producción con `VITE_API_URL=/api` | Aprobado | `build.log` |
| Presupuesto de tamaño del frontend acumulado | **Fallido; pendiente** | `performance.log` |
| Reproducción de la capa antigua frente a la actual | Oculta en 15000; visible en 21000 | `reproduction.log` |

Las 47 comprobaciones abarcan selección con ratón y teclado, seis motivos, curso inicial, filtros que pueden vaciarse, edición con curso previo, país de pasaporte, validación de «Otro», errores de guardado, reintento, catálogo vacío/inválido/lento, ausencia de excepciones JavaScript inesperadas y presentación a 1366, 390 y 320 píxeles. Se inspeccionaron las capturas de escritorio, móvil y modo oscuro.

Todas las llamadas API del navegador están interceptadas con datos ficticios. El éxito de guardado comprueba el envío de curso/motivo y la respuesta visual, **no una persistencia en PostgreSQL**. Los HTTP 503 que aparecen en los logs son fallos inyectados deliberadamente. Ancho móvil no equivale a teléfono físico ni prueba el teclado virtual.

Detalle importante de la reproducción: Radix desactiva eventos de puntero fuera de su menú. Por eso un hit-test puede devolver el menú incluso si el formulario lo tapa visualmente. Se verificaron también el orden efectivo de capas, la superficie que lo cubre y las capturas; no se usó solo «el elemento existe» como aceptación.

Capturas (solo datos ficticios):

- [Motivos en escritorio](../output/playwright/student-manual-20260930/motivos-desktop.png).
- [Motivos en ancho móvil](../output/playwright/student-manual-20260930/motivos-mobile-layout.png).
- [Tema oscuro a 320 px](../output/playwright/student-manual-20260930/motivos-dark-320.png).
- [Ayuda actualizada](../output/playwright/student-manual-20260930/ayuda-mobile.png).
- [Novedades](../output/playwright/student-manual-20260930/novedades-desktop.png).

Regresión reutilizable: `frontend/scripts/verify-student-manual.browser.js`, ejecutada mediante Playwright CLI. No instala credenciales ni necesita una base de datos. Sus interceptores deben mantenerse: no es una prueba para apuntar a producción.

## Pendiente detectado en la actualización acumulada

El build se genera correctamente, pero `npm run test:performance` supera cinco límites existentes. Valores redondeados en KiB:

| Métrica | Actual | Límite |
| --- | ---: | ---: |
| JavaScript total | 2225 | 2188 |
| JavaScript total gzip | 657 | 650 |
| JavaScript propio y de interfaz | 1293 | 1255 |
| JavaScript propio gzip | 383 | 380 |
| CSS total | 518 | 495 |

Los límites de carga inicial y del mayor archivo sí pasan. Esto no prueba un fallo funcional ni una lentitud medida en el colegio, pero impide presentar el control de calidad completo como verde. Falta analizar y optimizar el peso acumulado; no se aumentaron los límites para ocultar el fallo.

## Límites y entorno

- Sin escrituras a la base de datos, migraciones, cambios de credenciales ni contacto con el servidor del colegio en esta ronda.
- No se sustituyó el servicio habitual de `localhost:80`. Se utilizó un preview temporal exclusivamente de frontend; no es un enlace funcional para iniciar sesión con el backend del colegio.
- La prueba contra backend/PostgreSQL real no se repitió; las pruebas del chat del 27 de septiembre conservan su fecha y su alcance propios.
- Se intentó una revisión independiente con subagente, pero no pudo ejecutarse por límite de uso. No se cuenta como revisión realizada.
- Los primeros intentos del nuevo recorrido requirieron corregir el nombre esperado de un filtro («Vigentes») y esperar el foco del menú antes de Enter. Los resultados finales arriba corresponden al recorrido corregido, no a esos intentos fallidos.

El método de depuración y verificación separó reproducción, corrección y prueba de límites; una suite finita no garantiza ausencia absoluta de bugs.
