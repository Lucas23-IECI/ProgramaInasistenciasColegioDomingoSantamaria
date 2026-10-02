# Evidencia HTTPS — 24 de septiembre de 2026

## Resultado y alcance

**La instalación completa pasó en Windows elevado sobre una copia aislada: 46/46 comprobaciones, 6/6 comprobaciones del navegador y limpieza completa.** También pasaron 33/33 comprobaciones nativas de certificados/cliente/firewall, las suites unitarias y TLS con Docker/backend QA reales. Las acciones privilegiadas se ejecutaron con autorización expresa del usuario. No se ha desplegado en el colegio ni se ha probado un segundo PC físico.

No se hicieron commits ni push. Los contenedores principales conservaron sus IDs y el sistema habitual continúa por HTTP. No se modificaron cuentas, contraseñas ni registros de la base principal. La prueba optativa de aplicación añade únicamente trazas normales de inicio/cierre de sesión a la base QA existente.

## Resultados finales

| Bloque | Resultado | Qué fue real / qué se simuló |
| --- | --- | --- |
| Certificados | 15/15 en PowerShell 5.1 y 15/15 en 7 | RSA, exportación PKCS#1, firmas .NET/Node y ACL de carpetas reales; creación/retirada del almacén Windows simuladas |
| Cliente | 44/44 en PowerShell 5.1 y 44/44 en 7 | Handshake TLS real con raíz correcta/equivocada, SAN incorrecto y certificado vencido; importación/retirada de TrustedRoot simuladas en esta suite; regresión de ejecución del paquete por `-File` sin parámetros de ruta |
| Instalador/recuperación | 29/29 en PowerShell 5.1 y 29/29 en 7 | Archivos, ZIP, hashes, reemplazo atómico y renderizado Compose reales; red, firewall, almacenes y cambio de contenedores simulados en esta suite |
| Docker/TLS | 23/23 verificaciones de la ronda final PS5.1 | Nginx real con imágenes existentes, puertos altos aislados, TLS, cabeceras, SSE y persistencia del override; incluye un bloque adicional de aplicación real |
| Aplicación real QA | 10/10 comprobaciones dentro de esa ronda Docker | Backend real, base QA, login/logout, cookie Secure/HttpOnly/SameSite, sesión, chat y rechazo CORS |
| Diagnóstico en servidor local | Correcto, sin cambios | Lectura de Docker, entorno efectivo, montajes, IP/red y herramientas |
| Windows nativo elevado | 33/33; limpieza completa | CA CNG RSA3072 no exportable, renovación con la misma CA, certificados de servidor, TrustedRoot, cliente distribuible, firewall y Nginx reales |
| Instalador completo elevado | 46/46; limpieza completa | Scripts distribuidos reales, cuatro servicios y base de datos desechables, respaldo, activación, cliente interactivo, estado, repetición, recuperación, reintento y renovación |
| Navegador real | 6/6, dentro del bloque de instalación completa | Microsoft Edge 153.0.4234.48, sin excepciones de certificado, login desde UI, contexto seguro, cookie protegida, recarga y sesión |
| Sintaxis | 13 archivos PowerShell válidos | Parseo; no equivale a ejecutar todas las acciones |

Son comprobaciones/assertions, no cantidades de funciones diferentes. Las repeticiones en dos motores no son casos distintos. Las diez comprobaciones de aplicación están incluidas en un bloque de la ronda Docker, y las seis de navegador en un bloque de la instalación completa; no sumar estos números como si fueran independientes.

## Evidencia conservada

- Suites finales: `output/https/final-20260924/ps51-*.log` y `ps7-*.log`.
- Docker + backend real: `output/https/integration-20260924-230726-d85e63ac7cbf/results.json`.
- Sesión/chat reales: `output/https/integration-20260924-230726-d85e63ac7cbf/application-qa.json`.
- Docker/TLS previo en PowerShell 7: `output/https/integration-20260924-230024-69933d3eb56e/results.json`.
- Docker/TLS previo en PowerShell 5.1: `output/https/integration-20260924-230234-4b85113a1777/results.json`.
- Windows nativo: `output/https/native-c353c5b006fb4944992713c172c82378/results.json` y `transcript.txt`.
- Regresión del instalador tras añadir puertos aislados: `output/https/native-final-ps51-server.log` y `native-final-ps7-server.log`.
- Regresión final con el cliente corregido: `output/https/native-final-fixed-client-ps51-server.log`, `native-final-fixed-client-ps7-server.log`, `native-final-fixed-client-ps51-client.log` y `native-final-fixed-client-ps7-client.log`.
- Docker/TLS repetido tras los cambios: `output/https/integration-20260924-234055-e1aa3d1df978/results.json` (22 comprobaciones, sin el bloque optativo de login QA).
- Primera instalación completa elevada, **fallida en el cliente**: `output/https/full-native-ae2ac72f0fae/results.json`, `02-install.log` y `03-client.log`. Servidor instalado correctamente y limpieza completa; no se contabiliza como recorrido aprobado.
- Segunda ronda completa: `output/https/full-native-67b0ff957c93/results.json`. Cliente, Edge (6 comprobaciones), `estado.ps1`, recuperación, reintento y emisión renovada pasaron. Falló después por una inicialización ausente en el **verificador de pruebas** (`HttpsClientProbe` en su proceso principal), no en el instalador. Se corrigió antes de repetir; esta ronda tampoco se contabiliza como resultado global aprobado. Limpieza completa.
- **Instalación completa final aprobada:** `output/https/full-native-90041a5ae719/results.json` y `run.log`.
- Scripts ejecutados: `01-diagnosis.log`, `02-install.log`, `02b-shipped-status.log`, `03-client.log`, `05-repeat.log`, `06-restore.log`, `07-retry.log`, `08-renew-real.log`, `09-shipped-status-renewed.log`, dentro de esa carpeta final.
- Navegador: `output/https/full-native-90041a5ae719/browser/results.json`, `01-https-login.png` y `02-authenticated.png`. Las capturas se inspeccionaron visualmente; la segunda muestra el cambio obligatorio de contraseña de una cuenta recién creada en la base desechable, no un fallo de login.
- Alcance de la renovación: `renewal-trigger.json` y `renewal-result.json`, dentro de la carpeta final. Identidad de los contenedores habituales antes de empezar: `main-before.json`.

Los resultados no contienen contraseñas, cookies de sesiones reales ni conversaciones. Las carpetas de evidencia se excluyen de Git. Los workspaces temporales de las rondas finales, con claves efímeras y configuración QA, fueron eliminados al terminar; los contenedores y la red de cada prueba se retiraron, sin borrar volúmenes QA.

## Fallos encontrados y corregidos durante las pruebas

1. PowerShell 5.1 trataba el progreso normal de Compose en stderr como una excepción: ahora se comprueba su código de salida.
2. `File.Replace` recibía una cadena vacía en lugar de `null` al actualizar el journal en PS5.1: corregido y probado con reemplazos sucesivos.
3. Windows/Schannel rechazaba la CA privada por no disponer de CRL: se admite información de revocación no disponible sin desactivar la validación de raíz, IP y vigencia. Se volvieron a comprobar rechazos de raíz/nombre incorrectos.
4. Las contraseñas con `$`, `${...}` y `$$` podían compararse incorrectamente o alterarse al serializar Compose: comparación normalizada y snapshot sin doble escape, probados con Compose real y valores ficticios.
5. Diferencias PS5.1/7 al deserializar arrays/fechas y al compilar la comprobación TLS: corregidas y repetidas ambas suites.
6. La limpieza de la clave temporal del certificado de servidor no cubría fallos de exportación: trasladada a `finally`, conservando siempre la identidad de la CA.
7. Un override modificado por otra persona podía sobrescribirse al recuperar: ahora se exige el hash previsto. Las reglas de firewall preexistentes ajenas también bloquean sin modificarlas.
8. La primera instalación completa real detectó que Windows PowerShell 5.1, al ejecutar el cliente con `-File` sin `-BundlePath`, evaluaba `$PSScriptRoot` como vacío en el valor predeterminado del parámetro. Se resuelve ahora en el cuerpo del script. La regresión se ejecutó antes del cambio y falló, después pasó en ambos motores. La prueba nativa previa daba la ruta explícita: no cubría esta forma de ejecución documentada.

Los instaladores anteriores se retiraron porque mezclaban TLS con cambios de contraseñas, configuración de producción y hooks Git. El nuevo no realiza esas operaciones.

## Recuperación comprobada mediante fallos inyectados

Respaldo fallido, configuración Nginx rechazada, fallo durante cambio de contenedores, fallo TLS, fallo después de agregar confianza, recuperación interrumpida y reanudación explícita. Se verificó que:

- se conservan imágenes exactas y configuración anterior;
- no hay `down`, borrado de volúmenes ni reinicio de PostgreSQL/backup en el instalador;
- solo se retiran confianza/reglas recién creadas por el intento;
- se conserva la CA al reintentar, sin rotarla silenciosamente;
- la renovación recupera estado y override previos byte por byte;
- repetir una instalación vigente no crea otra autoridad ni reinicia servicios;
- el ZIP contiene exactamente tres archivos públicos;
- un diagnóstico sin administrador no escribe configuración.

## Comprobación nativa de Windows

Se ejecutó `Windows.Native.Integration.ps1` en Windows PowerShell 5.1, con UAC y un token administrador autorizado. No se usaron mocks de certificados, TrustedRoot ni firewall. Se confirmó que Windows rechaza HTTPS sin la raíz, acepta después de ejecutar el cliente real y vuelve a rechazar tras retirar la confianza. Una huella errónea no instala confianza; una respuesta real 503 del backend revierte la raíz recién añadida, pero conserva una raíz preexistente. Repetir el cliente no la duplica.

La limpieza retiró exclusivamente los certificados y contenedores propios, la clave CNG no exportable, la regla de firewall temporal y los archivos privados. Se compararon ID, imagen y fecha de arranque de los cuatro servicios habituales: ninguno fue reemplazado ni reiniciado. La regla de esta primera prueba permitió solo la IP propia y puertos altos; no demuestra conectividad desde otro equipo.

## Instalación completa y navegador comprobados

La ronda final ejecutó el instalador real en una copia separada, con imágenes existentes, nueva base PostgreSQL, archivos/volúmenes propios y credenciales ficticias. No se sustituyó la lógica del instalador por mocks. Pasaron:

- Diagnóstico sin cambios; respaldo real antes de la activación; certificados CNG no exportables, regla real de firewall y HTTPS.
- `estado.ps1` distribuido, copiado sin modificaciones y verificado por hash, tanto después de instalar como después de renovar.
- Cliente distribuido ejecutado desde `System32`, sin `-BundlePath` ni `-ExpectedRootSha256`, introduciendo por stdin la huella previamente validada en el `Read-Host` real. Windows rechazó la conexión antes de instalar confianza y la aceptó después.
- Edge real sin `ignoreHTTPSErrors` ni argumentos para ignorar certificados: login por formulario, cookie `Secure`/`HttpOnly`/`SameSite=Strict`, recarga y `/api/auth/me` correcto. No se eludió el cambio obligatorio de contraseña de la cuenta de prueba.
- Repetición sin nueva autoridad ni versión; recuperación real a HTTP; reintento conservando la identidad de la CA.
- Renovación real: nuevo certificado de servidor, mismo certificado raíz, confianza/firewall conservados, HTTPS y estado correctos. PostgreSQL y backup no se recrearon.

**Disparadores simulados, operaciones reales:** para recorrer `-Restaurar` se marcó pendiente el journal de la instalación desechable; no se afirma haber cortado la electricidad. Para recorrer `-Renovar` se adelantó únicamente `leaf_not_after` en los metadatos desechables a diez días; no se cambió el reloj ni se alteró la vigencia del certificado anterior. La emisión, intercambio en Docker y validación posterior sí fueron reales.

Todas las rondas retiraron sus certificados, claves, confianza, firewall, contenedores, volúmenes y directorios privados. Se conservaron registros de prueba y capturas. La revisión final confirmó que no quedan esas autoridades/reglas ni un `.https-lan`/override nuevo en la instalación habitual.

## Límite que no cubre esta evidencia

No se probó un segundo dispositivo físico ni el acceso entre equipos en la red del colegio. Redes separadas, antivirus y políticas del establecimiento también quedan fuera. La prueba local elevada **no garantiza** la conectividad de otro PC ni certifica todos los módulos de la aplicación o ausencia absoluta de fallos.

La renovación está implementada como comando manual, con aviso de vencimiento en `estado.ps1`; no se creó una tarea programada. La raíz dura cinco años y requiere sustitución planificada. No se afirma cifrado extremo a extremo, cifrado de respaldos ni ausencia absoluta de vulnerabilidades.

## Repetir las pruebas sin instalar confianza

Desde la carpeta del proyecto:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/https/tests/Certificates.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/https/tests/Client.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/https/tests/Server.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/https/tests/Server.Integration.ps1
```

La última requiere Docker y usa dos contenedores temporales sin base de datos. Solo en este entorno de desarrollo, con la base QA identificada explícitamente, puede agregarse `-AplicacionQa` para repetir login/chat reales. El test rechaza una base o volumen que no coincida con los identificadores QA permitidos. No ejecutar esa variante en el colegio.

## Repetir las pruebas nativas en desarrollo

Los scripts `scripts/https/tests/Windows.Native.Integration.ps1` y `Windows.FullInstall.ps1` **requieren consentimiento previo y Windows PowerShell 5.1 elevado**. No son comandos de actualización para Andrés. Crean temporalmente certificados y confianza en este Windows, reglas de firewall y contenedores aislados. Usan puertos altos; los valores normales del instalador siguen siendo HTTP 80 y HTTPS 443.

- `Windows.Native.Integration.ps1 -LanIp <IP-PRIVADA-DE-ESTE-PC>` prueba certificados/cliente/firewall con un backend de prueba sin base de datos. Guarda evidencia bajo `output/https/native-<RunId>`.
- `Windows.FullInstall.ps1 -LanIp <IP-PRIVADA-DE-ESTE-PC> -EvidencePath <RUTA-ABSOLUTA-NUEVA>` exige una carpeta nueva directamente bajo `output/https` llamada `full-native-` seguida de 12 caracteres hexadecimales. Crea cuatro servicios con imágenes existentes, credenciales ficticias y volúmenes propios. Ejecuta los scripts distribuidos sin reemplazar su lógica y prueba Edge sin ignorar errores de certificado.

Ambos comprueban identidad/imagen/arranque de los servicios habituales antes y después. La limpieza solo elimina recursos de su ejecución; si queda algo pendiente, lo registra y conserva el directorio privado para recuperarlo. Nunca usar una carpeta de pruebas anterior para volver a ejecutarlos. No se modifica el reloj del sistema para probar la renovación.
