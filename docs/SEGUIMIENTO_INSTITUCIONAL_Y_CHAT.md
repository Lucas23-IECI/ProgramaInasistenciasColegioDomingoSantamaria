# Seguimiento institucional y chat interno

## Resultado buscado

Incorporar dos módulos conectados al trabajo escolar real:

1. **Seguimiento institucional**: centro preventivo y operativo de casos del estudiante y su familia.
2. **Chat interno**: comunicación institucional asociable a estudiantes, retiros, visitas, seguimientos y casos de convivencia.

No se crea un segundo sistema de permisos, documentos ni auditoría. Ambos módulos reutilizan las cuentas, perfiles, alumnos, familias, documentos y trazabilidad existentes.

## Invariantes

- Todas las migraciones son aditivas y transaccionales.
- Ninguna automatización elimina, corrige ni reemplaza datos de origen.
- Una misma señal automática no puede abrir dos casos simultáneos.
- Desactivar una regla no borra los casos ya creados.
- Un seguimiento puede derivarse a Convivencia, pero no expone el contenido reservado de Convivencia.
- Una cuenta solo puede leer conversaciones donde es miembro.
- El permiso para administrar canales no entrega acceso silencioso a chats privados.
- No se implementa cifrado extremo a extremo general: se priorizan HTTPS, disco y respaldos cifrados, permisos, membresía, retención y auditoría institucional.
- No se eliminarán mensajes por políticas de retención hasta que el establecimiento defina y apruebe formalmente esos períodos.

## Seguimiento institucional

### Señales automáticas iniciales

- Tres atrasos en treinta días.
- Cinco atrasos en treinta días.
- Alta manual todavía no vinculada con ERP.
- Estudiante activo sin curso.
- Estudiante sin apoderado o persona autorizada vigente.
- Tres retiros entregados en treinta días.
- Visita abierta por más de doce horas.
- Retiro solicitado o autorizado sin resolver por más de doce horas.
- Conflicto de identidad pendiente.

Las detecciones se registran como señales explicables. El sistema conserva el umbral, período y datos que justificaron la apertura. No utiliza puntajes opacos.

La ejecución periódica queda desactivada por defecto para evitar abrir casos masivos al instalar una actualización sobre información aún no revisada. La acción **Revisar ahora** ejecuta primero una previsualización de solo lectura y muestra cuántas condiciones detectó. Los seguimientos se crean o actualizan únicamente después de una confirmación explícita. Después de la aceptación operacional, una cuenta autorizada puede habilitar la ejecución periódica desde **Configurar reglas**. La política se conserva en PostgreSQL y no depende de reconstruir el contenedor.

### Política confirmada por Dirección el 10 de agosto de 2026

- La regla preventiva se activa con **3 atrasos dentro de 15 días móviles**.
- El seguimiento se asigna inicialmente a una cuenta activa del perfil **Inspectoría**.
- El plazo institucional para resolver o avanzar el caso es de **3 días**.
- Si llega la fecha límite sin resolución, el caso escala simultáneamente a **Inspectoría** y **Equipo de Gestión**.
- La persona inspectora asignada conserva la responsabilidad; el escalamiento añade supervisión y avisos, no cambia silenciosamente al responsable.
- Los espacios institucionales de chat son **Inspectoría**, **Equipo de Gestión** y **Equipo de Convivencia**.
- Las conversaciones se conservan durante el año escolar, configurado actualmente como **365 días**.
- La eliminación automática por retención continúa desactivada hasta que exista una aprobación operacional expresa.

### Automatización operativa implementada

- Ejecución idempotente con intervalo configurable.
- Asignación al integrante activo con menor carga dentro del perfil responsable.
- Escalamiento explicable de casos vencidos.
- Avisos internos por asignación y vencimiento, con bandeja y confirmación de lectura.
- Edición individual de reglas, perfil responsable, plazo, margen y prioridad.
- Equipos de escalamiento configurables por regla, con destinatarios derivados de los perfiles activos.
- Canales institucionales sincronizados con las cuentas activas de cada perfil.
- Configuración desactivada por defecto y ejecución manual disponible para validar antes de habilitarla.

### Flujo de caso

`ABIERTO → ASIGNADO → EN_CONTACTO → EN_SEGUIMIENTO → RESUELTO → CERRADO`

Un caso también puede escalarse, anularse con motivo o reabrirse. Cada transición incrementa su versión y genera un evento de línea de tiempo.

### Contenido

- Estudiante principal y estudiantes relacionados.
- Responsable institucional y fecha límite.
- Tareas.
- Notas internas.
- Llamadas, mensajes, correos, entrevistas y reuniones.
- Acuerdos y compromisos.
- Documentos.
- Conversación institucional vinculada.
- Derivación a Convivencia.
- Resultado final y línea de tiempo completa.

## Chat interno

### Tipos

- Conversación directa.
- Grupo de trabajo.
- Canal institucional.
- Conversación de contexto vinculada a un objeto del sistema.

### Capacidades

- Mensajes normales, urgentes y de sistema.
- Respuestas.
- Menciones.
- Adjuntos validados.
- Confirmación de lectura.
- Mensajes fijados.
- Búsqueda y paginación.
- Horario de silencio y silenciamiento temporal.
- Indicador de no leídos dentro de la aplicación.
- Vínculos a estudiante, retiro, visita, seguimiento, convivencia o documento.

### Operación en tiempo real y gobierno

- Actualización mediante eventos SSE en el servidor institucional, con sondeo de respaldo cada sesenta segundos.
- Administración de miembros sin ampliar silenciosamente el acceso a conversaciones privadas.
- Preferencias por conversación: menciones, avisos, horario de silencio y pausa temporal.
- Política global y política específica por conversación.
- Previsualización de mensajes y archivos vencidos antes de aplicar una retención.
- Retención automática y aplicación manual desactivadas hasta contar con una política institucional aprobada.
- Los mensajes fijados pueden excluirse de la política y toda aplicación queda auditada.

## Seguridad

- Permisos verificados en API y UI.
- Membresía verificada en cada lectura, escritura, búsqueda y descarga.
- Archivos limitados a PDF, PNG y JPG, máximo 8 MB, con firma real del archivo y nombre aleatorio.
- Contenido sensible no se duplica dentro del detalle general de auditoría.
- Crear canales, cambiar miembros, enviar urgentes, fijar o moderar mensajes sí genera eventos administrativos auditables.
- Los mensajes eliminados se conservan como registro retirado con actor, fecha y motivo; no desaparecen físicamente.

## Criterios de aceptación

- Las reglas automáticas son idempotentes y explicables.
- El resumen, los filtros y los detalles de seguimiento funcionan con paginación.
- Un seguimiento puede asignarse, recibir tareas, contactos, acuerdos, notas y cerrarse con trazabilidad.
- Una conversación directa no se duplica para el mismo par de cuentas.
- Una cuenta externa a una conversación recibe 403 aunque conozca su ID.
- Los no leídos, menciones, lecturas y mensajes fijados se actualizan correctamente.
- Los vínculos de contexto abren el objeto correcto sin ampliar permisos.
- Escritorio, tablet y móvil no presentan desbordamiento horizontal.
- Lint, pruebas unitarias, build y pruebas E2E críticas quedan verdes antes de publicar.

## Estado local al 10 de agosto de 2026

La implementación de software de ambos módulos está completa en la rama local `testing`. Las configuraciones automáticas sensibles permanecen apagadas. La regresión final aprobó 143 pruebas backend, 47 frontend y 32 recorridos E2E en escritorio y Android, con dos omisiones intencionales de plataforma. El limitador de API fue validado por cuenta autenticada e IP real para evitar bloqueos cruzados dentro de la red escolar. Quedan fuera del cierre técnico local únicamente la aprobación institucional de reglas y retención, y la aceptación física en la red y dispositivos del colegio.
