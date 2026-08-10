# Analítica institucional y PWA operativa

## Alcance implementado

La analítica institucional complementa las estadísticas de puntualidad existentes. No
presume asistencia, no inventa días lectivos y no utiliza puntajes opacos. Todas las
métricas se calculan únicamente sobre registros existentes y cada alerta informa la
regla exacta que la activó.

El panel reúne:

- tendencia diaria de ingresos y atrasos;
- comparación entre cursos y bloques horarios;
- estudiantes que redujeron atrasos entre ambas mitades del período;
- reincidencia antes y después de una intervención de convivencia;
- relación descriptiva entre contacto con apoderados y cierre de casos;
- retiros anticipados y motivos de visita;
- casos de convivencia abiertos, resueltos y tiempo medio de resolución;
- carga de trabajo agregada por cargo o perfil responsable;
- alertas explicables, sin un puntaje oculto.

La relación entre contacto con apoderados y cierre de casos es descriptiva. El sistema
no la presenta como causalidad.

## Reportes y programaciones

Los usuarios autorizados pueden exportar el período activo a PDF o Excel. También se
pueden definir reportes internos semanales o mensuales. El programador:

1. revisa las programaciones cada quince minutos;
2. genera el período anterior ya cerrado;
3. conserva una instantánea del resultado en la base de datos;
4. registra errores sin perder la programación;
5. utiliza un bloqueo de PostgreSQL para impedir ejecuciones simultáneas duplicadas.

La propia pantalla de analítica permite crear, consultar, pausar y reactivar estas
programaciones. Cada cambio exige el permiso administrativo específico y queda en
auditoría. La generación automática crea una ejecución interna consultable. No envía
correos ni información fuera del servidor por sí sola.

## Funcionamiento PWA

La aplicación incluye manifiesto, iconos institucionales y service worker. En un
navegador compatible puede instalarse en escritorio o celular y abrirse en modo
independiente.

La instalación se encuentra en el botón de descarga de las herramientas globales y
en `Menú de usuario -> Instalar aplicación`. Cuando el navegador permite una
instalación directa, se abre su confirmación nativa. En iPhone/iPad y navegadores que
no exponen esa confirmación, el sistema muestra instrucciones adaptadas. La identidad
instalada utiliza el escudo oficial del Liceo Domingo Santa María.

El sistema consulta actualizaciones al abrirse, al recuperar la conexión, al volver a
la pestaña y periódicamente durante una sesión extensa. Una versión nueva queda en
espera y muestra `Nueva versión disponible`; nunca recarga silenciosamente mientras
la persona puede estar completando un formulario. `Actualizar ahora` activa el nuevo
worker y recarga una sola vez. La base del servidor y la cola IndexedDB no se eliminan.

El service worker conserva solamente el shell y recursos estáticos versionados. Las
respuestas de `/api/` nunca se almacenan en caché.

## Operación segura sin conexión

La cola sin conexión se limita al registro de puntualidad en el terminal. No permite
crear o editar estudiantes, visitas, retiros, convivencia, documentos, permisos ni
configuración sin conexión.

Cuando el terminal todavía tiene una sesión válida y pierde la red:

1. busca al estudiante en un padrón operativo mínimo descargado previamente;
2. exige una coincidencia única;
3. guarda una operación con UUID, instante de captura y método de registro;
4. muestra el estado `Pendiente de sincronización`;
5. reintenta en orden cronológico al volver la conexión;
6. elimina la operación local solamente después de una respuesta aceptada;
7. el backend reconoce el UUID y no crea un segundo ingreso si se repite el envío.

El operador puede habilitar voluntariamente un aviso local del navegador. El permiso
se solicita mediante una acción explícita y el aviso aparece únicamente después de
que el servidor confirmó la sincronización. No se habilitan notificaciones remotas ni
se envían datos a proveedores externos.

El backend acepta operaciones diferidas con hasta 24 horas de antigüedad y rechaza
horas futuras superiores a cinco minutos. Aplica la jornada y el control horario del
instante capturado, no del instante de sincronización.

El padrón mínimo queda aislado en IndexedDB por origen del navegador. No incorpora
cifrado adicional de aplicación; el computador o teléfono operativo debe tener sesión
de Windows o bloqueo de pantalla y acceso físico controlado.

## Requisitos para celular

La cámara, la instalación y el service worker requieren un contexto seguro. En el
servidor local se debe usar HTTPS con un certificado confiado por el teléfono y un
nombre o IP interna estable. `http://127.0.0.1` sirve para pruebas en el mismo PC, pero
`http://192.168.x.x` no habilita todas las capacidades PWA en un celular.

La aceptación física pendiente comprende:

- instalar y confiar el certificado en Android y, si corresponde, iPhone;
- comprobar escaneo con cámara trasera en el acceso real del colegio;
- cortar y recuperar la red con dos o más registros pendientes;
- reiniciar el navegador antes de sincronizar y confirmar que la cola persiste;
- comprobar que una repetición del mismo UUID no duplica el ingreso;
- revisar legibilidad, vibración y sonido en el entorno de Portería.

## Seguridad y datos

La migración `035_analitica_institucional_pwa.sql` es aditiva. Agrega metadatos de
idempotencia, tablas de programación y permisos; no elimina, reemplaza ni recalcula
registros históricos. Toda exportación y modificación de programaciones está protegida
por permisos y auditoría.
