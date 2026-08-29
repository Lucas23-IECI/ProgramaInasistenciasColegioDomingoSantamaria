# Auditoría funcional de los 22 puntos — 27 de agosto de 2026

## Lectura ejecutiva

La lista original mezclaba funciones ya implementadas, integraciones parciales y objetivos de aceptación institucional. Después de revisar rutas, servicios, migraciones, interfaz y pruebas reales, el estado correcto es:

- **22 puntos completos técnicamente**, incluyendo automatizaciones, integraciones, paneles, analítica enlazada, reportes, PWA, ayuda, pruebas y retiro de etiquetas obsoletas.

“Completo técnicamente” significa implementado y cubierto por pruebas; no reemplaza la validación humana del colegio.

## Estado punto por punto

| N.º | Función | Estado verificado | Falta exacta |
| ---: | --- | --- | --- |
| 1 | Reglas automáticas de Seguimiento | Completo | Validación institucional de umbrales y responsables. |
| 2 | Origen exacto de cada seguimiento | Completo | Validación con casos reales variados. |
| 3 | Seguimiento conectado con notificaciones | Completo | Ajustar preferencias si el colegio define horarios silenciosos. |
| 4 | Disparadores automáticos de notificaciones | Completo técnicamente | Probar destinatarios y horarios institucionales en operación. La caída total del servicio sigue dependiendo del monitor del servidor. |
| 5 | Evitar notificaciones repetidas | Completo | Validar en operación que los ciclos elegidos coincidan con la política del colegio. |
| 6 | Historial de notificaciones | Completo | Validación institucional de filtros y retención. |
| 7 | Chat desde todos los módulos | Completo | Validar permisos por cargo con usuarios reales. |
| 8 | Contexto y regreso desde chat | Completo | Validación institucional de nombres visibles. |
| 9 | Integración de Convivencia | Completo técnicamente | Acordar destinatarios y plazos definitivos con el colegio. |
| 10 | Integración documental | Completo | Definir los plazos oficiales por tipo documental. |
| 11 | Panel de Dirección | Completo técnicamente | Validar prioridades y lectura con Dirección. |
| 12 | Panel de Inspectoría | Completo | Ajustar prioridades con inspectoría durante aceptación. |
| 13 | Panel de Secretaría | Completo | Ajustar prioridades con secretaría durante aceptación. |
| 14 | Panel de Portería | Completo | Validación física en el equipo de Portería y con sus permisos definitivos. |
| 15 | Analítica enlazada a registros | Completo técnicamente | Mantener pruebas al incorporar nuevos indicadores. |
| 16 | Reportes programados | Completo técnicamente | Definir frecuencia y destinatarios institucionales antes de activar envíos reales. |
| 17 | Bandeja de sincronización offline | Completo técnicamente | Validar corte y recuperación en el equipo físico de Portería. |
| 18 | Estados de error PWA | Completo técnicamente | Validar mensajes en dispositivos y red institucionales. |
| 19 | Acciones rápidas desde estudiante | Completo técnicamente | Validar el flujo con perfiles reales. |
| 20 | Revisión visual transversal | Completo técnicamente | Realizar aceptación visual final con datos y dispositivos del colegio. |
| 21 | Pruebas de cruces nuevos | Completo | 190 pruebas backend, 78 frontend y 37 recorridos E2E aprobados; mantenerlas ante cambios. |
| 22 | Retirar “En desarrollo” | Completo técnicamente | Las etiquetas obsoletas fueron retiradas y una regresión impide que reaparezcan en los módulos cerrados. |

## Mejora adicional solicitada: gráfico y exportación

Quedó implementada y probada:

- Cantidades visibles sobre cada punto o barra.
- Tooltip al pasar el cursor, enfocar o tocar.
- Selección persistente mediante clic, toque, Enter o barra espaciadora.
- Cambio entre línea, barras y tabla.
- Control para mostrar u ocultar cantidades.
- Singular y plural correctos en el detalle.
- Diseño adaptable sin desbordar la página en Pixel 7.
- PDF A4 institucional con gráfico, KPI, alertas, cursos, bloques, visitas, retiros, carga de trabajo, metodología, pies y numeración.
- Paginación de tablas y protección contra páginas vacías o títulos cortados.

## Cierre técnico

Los 22 puntos no conservan una brecha de programación conocida. La evidencia ampliada, incluidos hallazgos corregidos durante una nueva ejecución completa, se encuentra en `AUDITORIA_GIGANTE_LOCAL_2026-08-28.md`.

La configuración del servidor se controla por separado y no debe confundirse con el estado funcional del código.
