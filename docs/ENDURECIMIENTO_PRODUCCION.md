# Endurecimiento antes de la instalación definitiva

Este documento separa lo que el sistema puede validar automáticamente de lo que debe comprobarse físicamente en el establecimiento.

## Preparación

1. Copiar `.env.production.example` a `.env` sin conservar ningún valor de ejemplo.
2. Generar contraseñas y secretos aleatorios, únicos y no reutilizados.
3. Definir un nombre interno estable, por ejemplo `asistencia.ldsm.test`, y una IP reservada en el router o servidor DHCP.
4. Ejecutar `.\scripts\preparar-https-red-interna.ps1` con el nombre y la IP definitivos.
5. Instalar la autoridad local de `mkcert` en cada equipo autorizado.

## Controles automatizados

Ejecutar:

```powershell
.\scripts\verificar-produccion.ps1
docker compose -f docker-compose.yml -f docker-compose.https.yml config --quiet
.\scripts\respaldo-ahora.ps1
.\scripts\probar-restauracion.ps1
.\scripts\estado.ps1
```

La verificación debe finalizar sin controles pendientes antes de declarar el sistema listo.

## Controles físicos obligatorios

- Confirmar acceso HTTPS sin advertencias desde cada computador y teléfono autorizado.
- Confirmar que el PC servidor conserva la misma IP después de reiniciar.
- Configurar Docker Desktop y el servicio de respaldo para iniciar con Windows.
- Reiniciar Windows y comprobar que PostgreSQL, backend, frontend y respaldos vuelven a estado saludable.
- Activar BitLocker o cifrado equivalente y guardar la clave de recuperación fuera del PC.
- Definir responsables de administración, respaldo, restauración y cierre operacional.
- Aprobar por escrito los períodos de retención de RUT, teléfonos, auditoría y documentos. El sistema no elimina automáticamente estos datos mientras la política esté pendiente.

## Principio de seguridad

El sistema nunca debe inferir asistencia ni ausencia. La matrícula, las reglas de puntualidad y los cursos históricos se conservan como evidencia del momento en que ocurrió cada registro.
