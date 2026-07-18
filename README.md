# Sistema de control de atrasos — Liceo Domingo Santa María

Aplicación institucional para registrar la hora de ingreso, identificar atrasos y mantener un seguimiento trazable por estudiante. Su alcance es puntualidad: no calcula asistencia, presentes ni ausentes.

## Qué permite hacer

- Registrar ingresos mediante código de barras o búsqueda manual.
- Clasificar automáticamente cada entrada según la hora límite vigente.
- Consultar y filtrar atrasos por fecha, curso, estudiante y severidad.
- Corregir o anular registros con motivo obligatorio e historial inalterable.
- Justificar atrasos y adjuntar PDF, PNG o JPG validados, con hash SHA-256.
- Administrar estudiantes, matrículas, cursos, usuarios y permisos.
- Importar nóminas y exportar reportes operativos.
- Revisar indicadores de puntualidad, alertas por recurrencia y auditoría.
- Operar en escritorio, tablet o teléfono con tema claro u oscuro y ayuda contextual.
- Generar respaldos verificados de la base y los documentos.

## Arquitectura

| Componente | Tecnología | Función |
| --- | --- | --- |
| Frontend | React 19, Vite, Nginx | Interfaz interna y terminal de registro |
| Backend | Node.js, Express 5 | API, reglas, autenticación y auditoría |
| Datos | PostgreSQL 16 | Estudiantes, matrículas, atrasos e historial |
| Respaldo | PostgreSQL Alpine y scripts POSIX | Copias diarias, manifiestos y retención |
| Cuestionarios | Cloudflare Pages, Functions y D1 | Levantamiento institucional independiente |

La instalación interna se ejecuta con Docker Compose en cuatro servicios: `postgres`, `backend`, `frontend` y `backup`.

## Instalación recomendada en el colegio

Para un PC Windows común, seguir [Instalación en Windows y red interna](docs/INSTALACION_WINDOWS_RED_INTERNA.md). El proceso asistido se inicia con:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\instalar-windows.ps1
```

Después de instalar, `scripts\estado.ps1` comprueba los servicios y `scripts\respaldo-ahora.ps1` crea un respaldo inmediato.

## Desarrollo local

Con Docker Desktop iniciado:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Antes de iniciar, reemplazar en `.env` `DB_PASSWORD`, `JWT_SECRET` y `DEFAULT_USER_PASSWORD`. La aplicación queda en `http://localhost`.

Para ejecutar por separado se requiere Node.js 20 o superior y PostgreSQL 16. El frontend de Vite usa `http://localhost:5173`, la API `http://localhost:5000/api` y los cuestionarios `http://localhost:8788`.

## Cuentas iniciales

En una base nueva se crean:

- `admin@ldsm.local`, con administración completa.
- `lector@ldsm.local`, para la terminal de registro.

Ambas reciben temporalmente `DEFAULT_USER_PASSWORD`. La clave debe cambiarse tras el primer acceso. Las importaciones de estudiantes nunca crean cuentas de acceso.

## Seguridad y operación

- Las sesiones usan JWT en una cookie `HttpOnly` y `SameSite=Strict`.
- En una LAN HTTP, usar `COOKIE_SECURE=false` y limitar `CORS_ORIGIN` a direcciones internas explícitas.
- Con HTTPS, usar `COOKIE_SECURE=true`.
- Los documentos se validan por formato, tamaño y firma real, y se almacenan fuera del frontend.
- Las acciones administrativas y correcciones quedan auditadas.
- Los secretos, nóminas, exportaciones, documentos y respaldos no deben versionarse.

La rutina diaria, recuperación e incidentes está en [Operación, respaldo y recuperación](docs/OPERACION_Y_RECUPERACION.md).

## Validación técnica

```powershell
Set-Location backend
npm ci
npm run check
npm test

Set-Location ..\frontend
npm ci
npm run lint
npm run build

Set-Location ..\questionnaires
npm ci
npm test

Set-Location ..
docker compose config --quiet
```

GitHub Actions repite estos controles, audita dependencias y construye las imágenes Docker. Dependabot propone actualizaciones semanales sin mezclarlas automáticamente con cambios funcionales.

## Datos personales

Usar únicamente datos ficticios en desarrollo. No publicar RUT, nombres, correos, teléfonos, documentos médicos, contraseñas, respaldos ni planillas reales. En producción, los accesos deben corresponder a funciones institucionales y revisarse cuando una persona cambia de cargo.

## Trabajo pendiente con el establecimiento

Antes de una puesta en producción definitiva deben quedar aprobados responsables, horarios, criterios de atraso, conservación de documentos, recuperación ante incidentes y tratamiento de datos. Las decisiones están ordenadas en [Plan de integración institucional](docs/PLAN_INTEGRACION_INSTITUCIONAL.md).
