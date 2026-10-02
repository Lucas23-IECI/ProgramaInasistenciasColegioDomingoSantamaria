# Chat: fotos, grupos y apariencia personal — 27 de septiembre de 2026

## Resultado y alcance

Se cierra el bloque recuperado del 25 de septiembre dentro del alcance probado. Los cambios permanecen locales, en `testing` sobre `c6ac038`, sin commits ni push. No se reemplazó la instalación habitual de `localhost:80` ni se modificó la instalación del colegio.

Preview funcional: <http://127.0.0.1:4174/chat>. Usa el frontend fuente y el backend QA en `127.0.0.1:5002`, con la base aislada `ldsm_codex_manual_019ffb95`. El servicio de preview debe seguir ejecutándose para que este enlace responda.

## Implementado

- Chat completo que aprovecha el ancho disponible; editor de escritorio de una fila que crece al escribir. En teléfono se separan texto y herramientas para conservar controles utilizables.
- Se conservan el regreso al panel, la ventana flotante, borradores, menciones, urgencia, fijados, adjuntos y contexto institucional.
- Fotos JPG/PNG dentro de la conversación, visor con ampliación, descarga y navegación por teclado. Un fallo de miniatura conserva la descarga del archivo.
- Grupos manuales: foto, nombre, descripción, integrantes, propietarios y administradores; opción para permitir escribir solamente a administradores. Estos permisos se verifican también en el servidor, incluidas las rutas alternativas de archivos.
- El último propietario no puede salir ni perder su rol. Dos cambios simultáneos tampoco pueden dejar al grupo sin propietario. Reincorporar un integrante no recupera sus privilegios antiguos.
- Canales institucionales sincronizados: sus datos, integrantes, roles y retención se administran desde los equipos institucionales. La interfaz explica la restricción y el servidor rechaza cambios manuales que el sincronizador reemplazaría. Los avisos personales siguen disponibles.
- Apariencia por cuenta: fondos institucional, salvia, arena, azul o imagen propia JPG/PNG hasta 4 MB; tamaño de mensajes normal/grande; previsualizar, cancelar, guardar y restablecer. Restablecer elimina la imagen personal guardada.
- Fotos de grupo y fondos se normalizan en el servidor, con límites de tamaño y eliminación de metadatos. Las fotos y vistas previas requieren acceso a la conversación; los metadatos del grupo no incluyen los bytes de su foto.
- Cambio de cuenta, cierre de sesión o revocación de acceso retiran borradores y estados privados. Las respuestas tardías no se aplican a otra cuenta.
- Ayuda actualizada y dividida en conversaciones, coordinación, opciones del grupo y apariencia, conservando las explicaciones de fijados, retención y retorno al registro.

## Evidencia ejecutada

No se suman repeticiones focalizadas como casos adicionales. Las pruebas con API simulada, servidor real y tests de código son evidencias distintas.

| Verificación | Resultado final | Evidencia local |
| --- | --- | --- |
| Suite backend completa | 290/290 | `output/chat-backend-suite-20260927.log` |
| Suite frontend completa, después del último ajuste de ayuda | 149/149 | `output/chat-unit-verified-20260927.log` |
| Navegador: apariencia, grupos, fotos, distribución, flotante y ciclo de sesión; escritorio y Android emulado, API simulada | 136/136 | `output/chat-ui-verified-20260927.log` |
| HTTP y PostgreSQL reales: cuatro sesiones, permisos, concurrencia, fotos, apariencia, auditoría y migración | 19/19 | `output/chat-real-api-final-20260927.log` |
| Recorrido completo de navegador contra QA real, escritorio y Android emulado | 2/2 | `output/chat-real-ui-20260927.log` |
| ESLint final | Aprobado | `output/chat-lint-verified-20260927.log` |
| Compilación final de producción | Aprobada | `output/chat-build-verified-20260927.log` |

La migración aditiva `054_chat_presentacion.sql` se aplicó y comprobó en QA. El script `backend/scripts/verify-chat-presentation.js` exige autorización explícita mediante variable de entorno y comprueba el nombre de la base antes de crear datos sintéticos. La prueba de concurrencia ejecuta dos cambios de propietario reales contra PostgreSQL: uno se confirma y el otro recibe conflicto, conservando un propietario.

Los recorridos reales de interfaz crean grupos ficticios, envían mensajes por Enter, mencionan, marcan urgencia, adjuntan y descargan un PDF comparando bytes, fijan mensajes y conservan borradores entre chat completo/flotante. Además guardan foto y opciones del grupo, abren una imagen, amplían el visor y guardan/recargan un fondo personal. La apariencia previa de la cuenta QA se restaura al terminar.

También se inspeccionó el chat directamente en Brave: conversación, preferencias de grupo y apariencia con cancelación. Se revisaron capturas de móvil, escritorio y modo oscuro. Las pruebas de accesibilidad incluyen foco, Tab/Escape, contención del diálogo, ausencia de desbordamiento y análisis Axe de los nuevos diálogos. No equivalen a una auditoría WCAG exhaustiva.

Capturas de los recorridos reales:

- `frontend/test-results/chat-real-20260927/chat-real-flow-chat-real-c-58288-scarga-y-conserva-el-fijado-escritorio/chat-real-escritorio.png`
- `frontend/test-results/chat-real-20260927/chat-real-flow-chat-real-c-58288-scarga-y-conserva-el-fijado-movil-android/chat-real-movil-android.png`
- Capturas adicionales de regresión: `frontend/test-results/chat-verified-20260927/`.

## Defectos encontrados y corregidos durante la verificación

1. Canales automáticos ofrecían ediciones que el sincronizador podía sobrescribir: guardas en servidor y controles explicativos en la UI.
2. El diálogo de apariencia asignaba el rol de diálogo al formulario, incompatible con el chequeo de accesibilidad: se separaron contenedor de diálogo y formulario.
3. Cambiar de cuenta manteniendo la ruta podía conservar estado privado del componente: la vista se reinicia con la identidad de sesión.
4. La ayuda había perdido la explicación de quién puede fijar mensajes: repuesta y probada en escritorio/móvil.
5. Se mantuvieron las correcciones de la recuperación previa: liberar conexión SQL antes de emitir avisos, excluir bytes de fotos del contexto y alinear etiquetas y límites de campos.

Se conservan los logs de intentos fallidos. La primera prueba HTTP esperaba una forma de respuesta incorrecta para los adjuntos (`id` en vez de `adjunto.id`); se corrigió la prueba y se repitió completa. La primera ronda de apariencia también usaba un tamaño absoluto de fuente incompatible con la escala raíz; ahora comprueba la proporción prevista. La primera regresión conjunta tuvo 134 aprobados y 2 fallos de ayuda; el resultado definitivo después de corregirla es 136/136.

## Datos y límites

- Todas las mutaciones de esta ronda corresponden a QA. Las cuentas sintéticas del script HTTP se desactivan y sus conversaciones se archivan, conservando auditoría. Los dos grupos creados por los recorridos de interfaz permanecen identificados como QA para inspección.
- No se eliminaron registros del colegio ni se cambiaron credenciales. La configuración QA emite un aviso existente de contraseña de base de datos corta; esta ronda no la rota ni autoriza reutilizarla en producción.
- Móvil significa emulación en navegador: no acredita teclado virtual, cámara ni uso en un teléfono físico.
- El recorrido real de UI usa una cuenta. La prueba HTTP de permisos sí usa cuatro sesiones independientes; no se afirma haber verificado entrega/lectura en tiempo real entre dos navegadores físicos.
- Esta ronda usa HTTP de loopback. No repite ni amplía la certificación HTTPS anterior, ni introduce cifrado de extremo a extremo.
- No se implementan aquí respuestas citadas en la UI, reacciones, encuestas, mensajes de voz ni llamadas. No se presenta este bloque como «todo WhatsApp».
- La compilación pasó, pero no se sustituyó la imagen Docker habitual ni se ejecutó CI remota. Una suite finita no garantiza ausencia absoluta de errores.

## Cómo revisar esta versión

1. Abrir el preview del chat e iniciar sesión con la cuenta local QA.
2. Icono de paleta en **Conversaciones**: apariencia personal. En móvil, volver primero al listado de conversaciones.
3. Abrir un grupo y pulsar **Preferencias** (tres puntos): pestañas **Avisos**, **Grupo** e **Integrantes**, según los permisos de la cuenta.
4. Adjuntar una imagen JPG/PNG, abrir su miniatura y probar ampliación/descarga.
5. Probar **Usar chat flotante**, minimizar y regresar a la vista completa con un borrador escrito.
