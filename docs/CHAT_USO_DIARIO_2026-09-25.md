# Chat: distribución para uso diario — 25 de septiembre de 2026

Iteración posterior al chat integrado/flotante. El usuario señaló que el diseño seguía sintiéndose comprimido. Esta revisión cambia la presentación y corrige el editor; no cambia las reglas de acceso, retención, base de mensajes ni registros institucionales.

## Cambios

- Lista adaptable de 320–360 px en escritorio; título/hora en una fila y vista previa en otra. El nombre del emisor ya no consume todo el espacio del mensaje. No se identifica a una persona por coincidencia de nombres.
- Cabecera superior aprovechada sin tapar las herramientas globales; se mantienen **Panel principal** y **Usar chat flotante**.
- Se retiran los márgenes que estrechaban artificialmente el historial a 780 px. Texto de mensajes de 15 px como mínimo con escala actual, burbujas ajustadas al contenido hasta 540 px y metadatos integrados para evitar filas vacías.
- Área de escritura separada y cómoda, con herramientas debajo. La altura incluye bordes y se recalcula al cambiar el ancho; no muestra scroll vacío, pero permite desplazarse al alcanzar 144 px.
- Al crecer el editor o cambiar el tamaño, quien estaba al final sigue viendo el último mensaje; quien lee arriba no salta al final.
- Menciones y aviso de mensajes nuevos usan la altura real del editor, sin superponerse al texto multilínea.
- Hasta 900 px se presenta lista o conversación, evitando dos columnas demasiado estrechas. La ventana flotante conserva su distribución compacta.

La guía `polish-web-ui` orientó la redistribución del espacio y la revisión de capturas, conservando los colores, rutas y funciones existentes. Hubo revisión independiente del código; se descartó inferir «Tú» comparando nombres y se corrigió el anclaje de las menciones.

## Evidencia de esta iteración

- Regresión de interfaz, chat flotante y ciclo de sesión: **88/88**, `output/chat-diario-final-20260925.log` y `frontend/test-results/chat-diario-final-20260925/`. API simulada: no acredita por sí sola persistencia ni permisos del servidor.
- Flujo real: **2/2**, escritorio y Android emulado, `output/chat-diario-real-20260925.log`. Sin respuestas simuladas: creación de grupo, mensajes con Enter, urgencia/mención, adjunto PDF, descarga de los mismos bytes, fijado, borrador entre vistas, envío flotante y comprobación persistente tras recargar.
- Frontend unitario: **149/149**, `output/chat-diario-unit-20260925.log`.
- ESLint sin errores ni advertencias: `output/chat-diario-lint-20260925.log`.
- Build aprobado: `output/chat-diario-build-20260925.log`.
- `git diff --check` de los archivos de esta iteración sin errores de espacios.

Se inspeccionaron capturas reales del render en claro/oscuro, escritorio, vista estrecha y flotante. Se recorren anchos de 320 a 1920 px; 1536×864 representa el área CSS de una pantalla 1920×1080 con zoom de 125%, no una prueba de cambiar el zoom físico del navegador.

La primera regresión detectó cinco desbordamientos provocados por situar el botón Fijar fuera de la burbuja y dos selectores obsoletos por el nuevo placeholder de búsqueda. Se retiró esa posición externa y se usa la etiqueta accesible estable para buscar. El registro inicial se conserva en `output/chat-diario-regresion-20260925.log`; no se presenta como aprobado.

## Entorno y límites

- Preview actualizado: `http://127.0.0.1:4174/chat`.
- Las dos pruebas reales verificaron antes de escribir el backend `ldsm_backend_codex_manual`, puerto loopback 5002, y la base aislada `ldsm_codex_manual_019ffb95`. Crearon dos grupos ficticios identificados como QA, con mensajes y archivos de prueba; no se borraron conversaciones existentes.
- No se sustituyó el sistema habitual de `localhost:80`, no se cambió el colegio, ni hubo commits o pushes.
- Android se emuló en Chromium: no se probó un teléfono físico. Estas pruebas tampoco acreditan TLS nuevo, cifrado de extremo a extremo ni entrega entre dos usuarios simultáneos.
- La revisión visual comprueba legibilidad, distribución y controles; la preferencia estética sigue requiriendo valoración del usuario.
