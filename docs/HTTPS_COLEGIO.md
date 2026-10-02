# HTTPS del colegio, sin comprar dominio

## Qué cambia

Se sigue usando el mismo PC, Docker, usuarios y base de datos. La dirección pasa de `http://IP` a `https://IP`. No se publica el sistema en Internet ni se compra nada.

Hay dos preparaciones iniciales: una en el PC servidor y otra en cada PC Windows que entra al sistema. **No puede conseguirse confianza HTTPS en todos los equipos solamente con un pull.** El navegador tiene que reconocer el certificado del colegio.

Este instalador requiere Windows con PowerShell 5.1, .NET Framework 4.8, Docker Compose con `up --wait` y curl con `--ssl-revoke-best-effort` (7.70 o posterior). Se ha probado con PowerShell 5.1/7, Compose 5.2 y Docker Desktop. Está destinado a una instalación existente y saludable con cuatro servicios; no instala Docker ni corrige redes externas.

## 1. En el PC que tiene Docker

Abrir PowerShell **como administrador**, dentro de la carpeta del proyecto, no en `C:\Windows\System32`.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\instalar-https-colegio.ps1 -Diagnostico
```

El diagnóstico no cambia nada. Si hay varias redes, indicar la IP que ya utilizan para abrir el sistema:

```powershell
.\scripts\instalar-https-colegio.ps1 -Diagnostico -LanIp 192.168.50.28
```

La IP del ejemplo corresponde a las capturas, **no es una IP que el instalador imponga**. Debe seguir perteneciendo al servidor y ser fija o estar reservada; el instalador no modifica el router.

Antes de instalar, terminar los registros en curso y comprobar que los equipos no tengan ingresos offline pendientes. La cola del navegador está vinculada a la dirección HTTP y no migra sola a HTTPS. No borrar datos del navegador ni desinstalar la PWA anterior antes de sincronizarla.

Cuando el diagnóstico sea correcto:

```powershell
.\scripts\instalar-https-colegio.ps1 -Aplicar -LanIp 192.168.50.28 -ConfirmarIpFija
```

Leer el resumen y escribir `INSTALAR`. Hace respaldo, prepara y comprueba certificados, reinicia solamente frontend/backend con las imágenes ya instaladas y valida HTTPS. No actualiza el código, no cambia contraseñas, no toca matrículas/atrasos y no recrea PostgreSQL ni el servicio de respaldo.

Al terminar muestra:

- El enlace seguro para entrar.
- La ruta de `Conectar-equipo.zip`, que se entrega a los otros PC.
- Una huella de 64 caracteres para confirmar que el paquete es auténtico. Entregar esa huella por otro medio, por ejemplo por teléfono o un mensaje de soporte verificado.

## 2. En los demás PC Windows

No necesitan Docker. Extraer `Conectar-equipo.zip` en una carpeta vacía: deben quedar **exactamente tres archivos** (`Confiar-Equipo.ps1`, `rootCA.cer`, `conexion.json`).

Abrir PowerShell como administrador en esa carpeta:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Confiar-Equipo.ps1
```

Pegar la huella recibida de soporte **por otro canal**. No copiarla del mismo ZIP ni de la propia pantalla: eso no verifica su procedencia. El instalador verifica que el servidor presenta el certificado correcto antes de agregar confianza y comprueba la aplicación después. Si falla, retira solo la autoridad recién agregada por ese intento.

Cerrar y volver a abrir Edge o Chrome, entrar al enlace `https://IP` e iniciar sesión. No aceptar «continuar de todos modos». Si había una PWA instalada por HTTP, abrir la nueva dirección segura e instalar desde ella después de comprobar la cola anterior.

Este paquete **no automatiza Android, iPhone, macOS ni navegadores con almacén de confianza independiente**. No presentar esas plataformas como probadas físicamente.

## Mantenimiento y recuperación

- `scripts\estado.ps1` comprueba certificado, IP, API y respaldo en el modo nuevo; advierte al acercarse el vencimiento.
- El certificado del servidor dura un año. Dentro de sus últimos 30 días ejecutar, como administrador, `scripts\instalar-https-colegio.ps1 -Renovar`. Reutiliza la misma autoridad; los PC no necesitan importar otra raíz. **La renovación no está programada automáticamente.**
- La autoridad dura cinco años. Antes de agotar ese plazo debe planificarse su sustitución y distribución. No se renueva silenciosamente una raíz confiada.
- Ante un fallo se intenta recuperar la configuración anterior. Si se interrumpe el proceso o falla la recuperación, ejecutar `scripts\instalar-https-colegio.ps1 -Restaurar`. No borrar `.https-lan` ni el override. Esta opción recupera una instalación incompleta; no revierte arbitrariamente instalaciones finalizadas.
- Los cambios externos del override bloquean la recuperación automática para no sobrescribir trabajo ajeno. Un puerto ocupado, red pública o configuración no coincidente también detienen el proceso antes de cambiarla.
- Un cambio de IP requiere intervención de soporte; no se cambian automáticamente el router ni las direcciones de los otros equipos.

## Seguridad y límites reales

La CA privada se genera en el almacén del servidor con clave no exportable. Los archivos privados y snapshots de recuperación quedan restringidos en `.https-lan`, ignorados por Git. **Nunca distribuir esa carpeta ni copiar claves privadas.** El ZIP de clientes contiene solo la raíz pública, la dirección y el instalador.

HTTPS cifra el tránsito entre navegador y servidor. No es cifrado extremo a extremo del chat, no cifra por sí mismo la base ni sus respaldos y no vuelve al sistema inmune a ataques. Una autoridad instalada es una decisión de confianza importante: proteger el PC servidor y sus administradores.

La CA local no tiene un servicio público de revocación. Las pruebas fijan la raíz exacta y validan IP, cadena y vigencia; curl permite ausencia de información de revocación con `--ssl-revoke-best-effort`, sin desactivar la validación de identidad. Si una clave se compromete, se necesita retirada y sustitución coordinada, no una excepción del navegador.

Los antiguos `preparar-servidor-recomendado.ps1` y `preparar-https-red-interna.ps1` están retirados y se detienen sin hacer cambios. Se evita mkcert en los PC finales: su propio proyecto lo presenta como herramienta de desarrollo y desaconseja ese uso ([documentación de mkcert](https://github.com/FiloSottile/mkcert)).

## Evidencia

Ver [pruebas y límites de esta entrega](PRUEBAS_HTTPS_2026-09-24.md). Se ejecutó la instalación completa en Windows elevado con una copia desechable y Edge real, sin saltarse la validación de certificados; también se comprobaron cliente, estado, recuperación y renovación. Las simulaciones unitarias están identificadas aparte. No se ha desplegado en el colegio ni comprobado un segundo PC físico en su red.
