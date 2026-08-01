# Puesta en marcha y aceptación en el colegio

Este procedimiento contiene únicamente las acciones que deben ejecutarse o
confirmarse físicamente en el establecimiento. La aplicación, sus pruebas,
la restauración temporal, el ERP oficial y la interfaz responsive se validan
antes de publicar la rama `test`.

## 1. Actualizar el código desde la rama de pruebas

No ejecutar `git init` dentro de una carpeta descargada como ZIP. Primero abrir
PowerShell en la carpeta del sistema y comprobar:

```powershell
git status
git remote -v
```

Si la carpeta ya es un clon conectado a GitHub:

```powershell
git fetch origin
git switch test
git pull --ff-only origin test
```

Si `test` todavía no existe localmente:

```powershell
git fetch origin
git switch --track origin/test
```

Si aparece `not a git repository`, `origin` no existe o Git informa cambios
locales, no forzar ni borrar archivos. Conservar `.env`, `certs` y los
respaldos, y preparar un clon limpio antes de continuar.

## 2. Preparar el PC servidor y la red

- Conectar el servidor idealmente por cable.
- Reservar una IP fija en DHCP o asignar un nombre DNS interno estable.
- Confirmar que los equipos autorizados pueden llegar al servidor por TCP 443.
- Confirmar que la Wi-Fi no aplica aislamiento entre los clientes autorizados.
- No abrir ni redirigir el puerto del sistema hacia Internet.
- Desactivar la suspensión automática del PC mientras esté conectado a corriente.
- Activar el inicio automático de Docker Desktop con Windows.

Registrar como evidencia la IP reservada, el nombre interno, la red desde la
que se probó y el responsable técnico que hizo el cambio.

## 3. Endurecer la configuración del colegio

Antes de iniciar el modo definitivo, actualizar el `.env` del servidor sin
enviar sus valores por mensajería ni incorporarlos a Git:

- `NODE_ENV=production`.
- `STRICT_ENV_VALIDATION=true`.
- `COOKIE_SECURE=true`.
- Contraseña de PostgreSQL de al menos 16 caracteres aleatorios.
- Secreto de sesión de al menos 32 caracteres aleatorios.
- `CORS_ORIGIN` limitado a los nombres e IP HTTPS realmente utilizados.

Comprobar el resultado con:

```powershell
.\scripts\verificar-produccion.ps1
```

No declarar la instalación lista mientras el diagnóstico muestre controles
pendientes.

## 4. Instalar HTTPS confiable

Generar una autoridad y un certificado propios del colegio. No reutilizar ni
copiar la clave privada de otro computador.

```powershell
winget install --id FiloSottile.mkcert -e
.\scripts\preparar-https-red-interna.ps1 -LanIp IP-DEL-SERVIDOR -InstalarAutoridadLocal
```

Configurar `asistencia.ldsm.test` en el DNS interno o en los equipos de prueba,
incluyéndolo junto a la IP en el certificado. Después iniciar:

```powershell
$env:HTTPS_CORS_ORIGIN='https://asistencia.ldsm.test,https://IP-DEL-SERVIDOR'
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
.\scripts\estado.ps1
```

Distribuir únicamente `rootCA.pem`. Importarlo en las autoridades raíz de
confianza de cada PC y teléfono autorizado. La clave `rootCA-key.pem` y la
clave del certificado permanecen exclusivamente en el servidor.

## 5. Probar dispositivos físicos

### Pistola de códigos

1. Iniciar sesión con una cuenta de Portería/Lector.
2. Abrir Registro de estudiantes y elegir Pistola de códigos.
3. Leer un carnet válido y comprobar nombre, curso, hora y clasificación.
4. Repetir el mismo código inmediatamente y confirmar que no se duplica.
5. Leer un código inexistente y confirmar que informa el problema sin bloquear
   el terminal.
6. Volver al panel y verificar que la pistola no siga escribiendo en otra vista.

### Cámara de teléfono

1. Abrir la URL HTTPS confiable desde Android y, si está disponible, iPhone.
2. Autorizar la cámara trasera y escanear el mismo código usado con la pistola.
3. Confirmar que pistola, cámara y búsqueda manual producen la misma ficha y
   aplican las mismas reglas.
4. Repetir la lectura y comprobar el bloqueo de duplicados.
5. Denegar el permiso y confirmar que la búsqueda manual sigue disponible.
6. Salir del escáner y verificar que el indicador de cámara se apaga.

La cámara procesa la imagen en el dispositivo; no deben aparecer fotografías
ni videos en el servidor.

## 6. Validar el flujo operativo real

- Registrar y cerrar una visita real o controlada.
- Registrar un retiro de uno y de varios hermanos.
- Comprobar un apoderado conocido y una persona no registrada.
- Autorizar, rechazar, entregar y anular casos controlados según los permisos.
- Cerrar el día de visitas y resolver todas las visitas o retiros abiertos.
- Verificar que auditoría identifica a la persona que ejecutó cada acción.
- Probar una cuenta de cada perfil que el colegio vaya a utilizar.
- Confirmar con Dirección quién puede ver documentos completos y exportarlos.

No usar datos inventados en la operación definitiva. Los registros de prueba
deben quedar identificados y cerrados o anulados con trazabilidad.

## 7. Reinicio, respaldo y recuperación

Fuera del horario de ingreso:

```powershell
.\scripts\respaldo-ahora.ps1
docker compose ps
```

Reiniciar Windows y comprobar que Docker Desktop y los cuatro servicios vuelven
a quedar saludables sin intervención técnica. Luego ejecutar:

```powershell
.\scripts\estado.ps1
```

Activar BitLocker o el cifrado institucional autorizado y custodiar su clave de
recuperación fuera del PC. Definir además una copia de respaldo cifrada fuera
del equipo servidor y aprobar responsables, frecuencia y retención.

## 8. Matriz de evidencia

| Control | Evidencia mínima | Responsable | Resultado |
| --- | --- | --- | --- |
| Rama de prueba | hash mostrado por `git rev-parse HEAD` | Informática | Pendiente |
| Servicios | captura o salida de `estado.ps1` | Informática | Pendiente |
| Red | PC y teléfono abren la URL definitiva | Informática | Pendiente |
| HTTPS | navegador sin advertencia y cámara habilitada | Informática | Pendiente |
| Pistola | lectura válida, inválida y duplicada | Portería | Pendiente |
| Cámara | Android y, si existe, iPhone | Portería | Pendiente |
| Visitas | ingreso y salida trazables | Portería | Pendiente |
| Retiros | uno, hermanos, rechazo y entrega | Inspectoría | Pendiente |
| Permisos | una cuenta por perfil efectivo | Administración | Pendiente |
| Reinicio | servicios saludables tras reiniciar Windows | Informática | Pendiente |
| Respaldo | copia local y copia cifrada externa | Informática/Dirección | Pendiente |
| Privacidad | responsables y retención aprobados | Dirección | Pendiente |

Por cada prueba registrar fecha, persona, equipo, sistema operativo, navegador,
URL, resultado y observación. Una falla no se corrige borrando evidencia: se
registra, se resuelve y se repite la prueba.

## Criterio de cierre

La instalación queda aceptada únicamente cuando:

- `verificar-produccion.ps1` no informa pendientes;
- la URL definitiva funciona por HTTPS sin advertencias;
- pistola y cámara fueron probadas físicamente;
- el reinicio real fue satisfactorio;
- existe respaldo recuperable fuera del PC;
- Dirección aprobó permisos, responsables y retención;
- la matriz anterior quedó firmada o respaldada institucionalmente.
