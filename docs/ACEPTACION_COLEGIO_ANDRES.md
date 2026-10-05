# Puesta en marcha y aceptación en el colegio

Este procedimiento contiene únicamente las acciones que deben ejecutarse o
confirmarse físicamente en el establecimiento. La aplicación, sus pruebas,
la restauración temporal, el ERP oficial y la interfaz responsive se validan
primero en `testing`. Andrés actualiza el notebook solamente después de que esos
cambios hayan sido aprobados y fusionados en `main`.

## 1. Actualizar el código después del merge a main

**Aviso:** `preparar-servidor-recomendado.ps1` y `preparar-https-red-interna.ps1` están retirados y se detienen sin cambios. HTTPS se prepara aparte, con [HTTPS_COLEGIO.md](HTTPS_COLEGIO.md), y no cambia contraseñas ni `.env` por sí solo. Tampoco instala el hook de actualización.

Andrés no debe cambiar a `testing`: esa rama es exclusivamente para desarrollo y
pruebas. Tampoco debe volver a ejecutar el instalador ni cargar nuevamente el
Excel por una actualización normal.

En la primera actualización, Andrés debe traer primero los scripts nuevos. Con
Docker ya abierto y fuera del horario de ingreso, ejecuta:

```powershell
git pull --ff-only origin main
```

Ese primer pull solo actualiza los archivos; todavía no reconstruye los
contenedores porque el hook aún no existe. Luego, en la misma carpeta, ejecuta
una sola vez:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\instalar-actualizacion-por-pull.ps1
```

Si el script informa que ya existe un hook ajeno, detenerse: no se sobrescribe
ni se elimina. Para aplicar inmediatamente el código recién descargado, ejecuta
una vez el actualizador:

```powershell
.\scripts\actualizar-servidor.ps1
```

En las actualizaciones siguientes, Andrés solo ejecuta:

```powershell
git pull --ff-only origin main
```

El hook local ejecuta respaldo, build, migraciones y controles de salud después
de un pull que trae cambios. El mensaje esperado es
`Actualización completada y saludable (...)`.
En una instalación HTTP interna se mostrará además un aviso explícito de que
no se declaró endurecimiento HTTPS; esto no fuerza una migración ni cambia la
dirección utilizada. En una instalación HTTPS gestionada o heredada se valida
su configuración vigente.
Andrés no debe editar `.env`, regenerar certificados ni ejecutar variantes de
Docker Compose. Si el pull no muestra la comprobación automática, detenerse y
enviar la salida a Lucas.

La actualización reconstruye la aplicación, pero conserva PostgreSQL, los
documentos y los respaldos en sus volúmenes. No usar `docker compose down -v`.

Si aparece `not a git repository`, `origin` no existe o Git informa cambios
locales, no ejecutar `git init`, no forzar y no borrar archivos. Conservar
`.env`, `certs`, respaldos y datos; primero debe regularizarse esa copia como
un clon válido del repositorio.

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

## 3. Configuración de seguridad — preparación separada

No ejecutar instaladores retirados ni cambiar `.env`, `DB_PASSWORD`, secretos o
certificados como parte de una actualización normal. Una instalación existente
puede seguir funcionando por HTTP interno; el actualizador la conserva y
comprueba la salud de Docker, pero no la declara endurecida por HTTPS. Si el
colegio decide migrar a HTTPS, Lucas o soporte debe seguir exclusivamente
[HTTPS_COLEGIO.md](HTTPS_COLEGIO.md), con respaldo y ventana de mantenimiento.

## 4. HTTPS confiable — solo cuando se autorice

La preparación vigente genera una autoridad y un certificado propios de la
instalación sin comprar un dominio. Ejecutarla únicamente con la guía
[HTTPS_COLEGIO.md](HTTPS_COLEGIO.md). No copiar `.https-lan`, claves privadas ni
certificados desde otro PC; los equipos autorizados reciben solo el paquete
`Conectar-equipo.zip` que genera el instalador y verifican su huella por otro
canal.

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
