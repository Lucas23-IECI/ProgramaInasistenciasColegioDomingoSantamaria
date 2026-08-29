# Auditoría técnica integral local — 28 de agosto de 2026

## Dictamen

El conjunto integrado localmente quedó técnicamente cerrado dentro del alcance que puede comprobarse en este equipo: código, base de datos, archivos, permisos, mensajes seguros, interfaz, accesibilidad, adaptación móvil, exportaciones, respaldo y restauración.

No quedaron fallos reproducibles en las compuertas finales. Esta conclusión no sustituye infraestructura externa ni aceptación en dispositivos del establecimiento. No se realizó commit, push ni despliegue.

## Hallazgos corregidos durante esta auditoría

1. Se corrigió una comparación PostgreSQL entre `integer` y `text` que impedía registrar actuaciones de Convivencia y reconciliar su alerta operacional.
2. Se corrigieron contrastes WCAG insuficientes en pestañas y enlaces de origen de Seguimiento.
3. El cierre de Seguimiento dejó de depender de `window.prompt`: ahora usa un diálogo accesible, valida el resultado, advierte tareas pendientes y conserva la historia.
4. Los rechazos CORS dejaron de aparecer como error 500: responden 403 con una causa clara y sin publicar la configuración interna.
5. Se recreó el backend con los orígenes vigentes; el navegador real volvió a iniciar sesión desde `localhost` y `127.0.0.1`.
6. Se eliminó una carrera E2E en la aparición tardía del diálogo de novedades, mediante una espera común y comprobable.
7. El contenedor backend incorporó fuentes DejaVu y Fontconfig para estabilizar PDF y OCR.
8. Se retiraron las etiquetas obsoletas “En desarrollo” de los módulos cuyo cierre técnico ya fue completado.
9. Se agregó una auditoría de integridad de solo lectura para migraciones, notificaciones, seguimientos, Convivencia, chat y documentos.
10. El recorrido de ayuda dejó de cargarse en el arranque y quedó aislado junto con XLSX y ZXing como herramienta diferida; además se añadieron compuertas automáticas de cobertura y rendimiento.
11. La validación integral ahora reconstruye y espera la salud de Docker antes de Playwright, para que los recorridos siempre correspondan exactamente al código que acaba de aprobar lint, pruebas y build.

## Evidencia final

| Capa | Resultado verificado |
| --- | --- |
| Backend estático | Núcleo, rutas, servicios y scripts aprobaron `npm run check`. |
| Backend unitario | 190 de 190 pruebas aprobadas; 0 fallos y 0 omisiones. |
| Frontend estático | ESLint aprobado sin errores. |
| Frontend unitario | 81 de 81 pruebas aprobadas; 0 fallos y 0 omisiones. |
| Cobertura backend | 59,16 % líneas; 69,42 % ramas; 80,35 % funciones; mínimos obligatorios aprobados. |
| Cobertura frontend | 78,97 % líneas; 70,52 % ramas; 67,80 % funciones; mínimos obligatorios aprobados. |
| Build | Vite transformó 3278 módulos y generó el paquete de producción. |
| Navegador | 37 recorridos aprobados en escritorio y Android; 3 omisiones intencionales por proyecto; 0 fallos. |
| Accesibilidad | Axe no detectó infracciones serias o críticas en las superficies cubiertas. |
| Adaptación | Las pantallas críticas no desbordan a 320, 375, 414 y 768 px. |
| Convivencia real | Acceso reservado, caso, participantes, actuación, PDF, cierre, bloqueo cerrado, reapertura, auditoría y limpieza aprobados. |
| Documentos reales | Sesión, permisos, carga, versiones, OCR, revisión humana, firma, PDF, descarga y limpieza aprobados. |
| Exportaciones | Tres libros XLSX aprobados; acceso no autorizado bloqueado; tres eventos de auditoría confirmados. |
| Integridad | 48 migraciones y 11 familias de inconsistencias verificadas; todos los contadores quedaron en cero. |
| Dependencias | Backend con 0 vulnerabilidades; frontend sin vulnerabilidades altas ni críticas. |
| Rendimiento | 482 KB por script mayor; 2082 KB JS total; 1150 KB JS de producto; 933 KB de herramientas diferidas; 445 KB CSS; 485 KB JS inicial; todos bajo presupuesto. |
| CORS seguro | Origen permitido operativo; origen ajeno rechazado con HTTP 403 y mensaje seguro. |
| Docker | PostgreSQL, backend, frontend y respaldo terminaron saludables. |
| Respaldo | Base, documentos y manifiesto SHA-256 generados y verificados. |
| Restauración | Entorno aislado aprobado; 404 estudiantes, 394 matrículas, 158 registros, 43 visitas, 8 retiros, 9 usuarios, 48 migraciones y 3 documentos coincidentes. |

Total automatizado principal: **308 comprobaciones aprobadas** —190 backend, 81 frontend y 37 recorridos Playwright—, además de cobertura mínima obligatoria, compilación, lint, auditorías de dependencias, APIs con datos temporales, integridad, PDF, salud Docker, respaldo y restauración.

## PDF de Analítica

La exportación usada en la prueba final conserva el período y los filtros visibles de la página.

- PDF A4 de dos páginas, sin cifrado ni JavaScript.
- Título y autor institucionales correctos.
- Período `01 ago 2026 al 28 ago 2026` visible y coincidente con la solicitud.
- Curso ficticio filtrado, justificación y severidad preservados.
- Indicadores, gráfico con cantidades, alertas, curso, bloque, metodología y pies completos.
- Texto extraíble y firma `%PDF-` válida.
- Ambas páginas fueron renderizadas e inspeccionadas: no presentan recortes, superposiciones ni contenido fuera de página.

## Estado interno restante

No queda una brecha de programación conocida en los módulos auditados. La única advertencia local vigente es de configuración: la contraseña actual de PostgreSQL tiene menos de 16 caracteres. El código ya la rechaza en validación estricta; su rotación corresponde a configuración de secretos y no debe automatizarse ni publicarse dentro del repositorio.
