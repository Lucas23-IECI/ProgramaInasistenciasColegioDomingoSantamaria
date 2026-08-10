# Gestión documental de estudiantes

## Propósito

El módulo reúne el expediente documental de cada estudiante sin reemplazar la
nómina, la matrícula, los atrasos, las justificaciones ni los casos de convivencia.
Cada archivo queda asociado a una ficha documental, una versión inmutable y la
persona que lo incorporó.

Ruta local: `http://127.0.0.1/admin/documentos`

## Alcance implementado

- Certificados, justificaciones, autorizaciones, actas, compromisos, documentos de
  identidad, antecedentes de matrícula, archivos familiares y otros antecedentes.
- Estado pendiente, vigente, vencido o archivado.
- Nivel de acceso institucional, reservado o muy reservado.
- Vigencia inicial y fecha de vencimiento opcional.
- Responsable de la incorporación y fecha de cada operación.
- Versiones sucesivas sin sobrescribir ni borrar el archivo anterior.
- Huella SHA-256 individual para comprobar la integridad de cada versión.
- Plantillas institucionales reutilizables y generación automática de PDF.
- Firma electrónica interna asociada al usuario autenticado y a una versión exacta.
- OCR local para imágenes JPEG y PNG, con aprobación o rechazo humano obligatorio.
- Búsqueda transversal, filtros de estado, categoría y vencimiento.
- Ayuda contextual para panel, expediente y detalle documental.

## Modelo y almacenamiento

La migración `034_gestion_documental_estudiantes.sql` agrega tablas nuevas. No
elimina, renombra ni reemplaza columnas existentes.

- `expedientes_documentales`: expediente único del estudiante.
- `documentos_expediente`: metadatos, categoría, acceso y vigencia.
- `documento_expediente_versiones`: archivo, huella, OCR y número de versión.
- `firmas_documentales`: constancias internas por versión.
- `plantillas_documentales`: contenido y campos permitidos para generar PDF.

Los archivos se guardan fuera del frontend público. Descargar exige sesión y permiso
de consulta. No existe una ruta de eliminación física; una ficha puede archivarse,
pero su historial permanece disponible.

## Permisos

- `documents.view`: consultar expedientes y descargar versiones.
- `documents.upload`: crear documentos e incorporar versiones.
- `documents.manage`: editar estado, vigencia y metadatos.
- `documents.sign`: registrar firmas internas.
- `documents.templates`: crear plantillas y generar PDF.
- `documents.ocr`: ejecutar y revisar OCR.

Administrador y el perfil protegido Gestión Documental reciben estos permisos en la
migración inicial. El resto de los perfiles no obtiene acceso implícito. Todas las
restricciones se validan en backend, además de condicionar las acciones visibles.

## Flujo de incorporación

1. Buscar y abrir al estudiante.
2. Elegir Incorporar documento.
3. Definir título, categoría, estado, acceso y vigencia.
4. Seleccionar un PDF, PNG o JPG de hasta 8 MB.
5. Guardar. La primera versión y su huella se crean juntas.
6. Para reemplazar el archivo, usar Nueva versión. El original se conserva.

## Plantillas y PDF

Las plantillas solo pueden utilizar campos expresamente permitidos. El sistema agrega
datos institucionales, estudiante, curso, fecha y responsable, marca los campos sin
resolver y genera un PDF en estado pendiente para revisión.

El PDF generado no se considera aprobado por el solo hecho de existir. Debe revisarse
y su estado debe actualizarse según el procedimiento del establecimiento.

## Firma electrónica interna

La firma registra identidad de la cuenta, declaración, fecha y huella SHA-256 de la
versión. Sirve como constancia autenticada dentro de este sistema. No se presenta como
firma electrónica avanzada ni reemplaza certificados, proveedores o formalidades que
la normativa exija para un documento concreto.

## OCR con revisión humana

El OCR se ejecuta localmente sobre JPEG y PNG. No envía fotografías a un servicio
externo y no aplica datos automáticamente a la ficha del estudiante. El resultado se
guarda como propuesta hasta que una persona autorizada compara el texto con el archivo
original y decide aprobarlo o rechazarlo.

Los PDF se mantienen en revisión manual en esta versión. Una lectura OCR correcta no
demuestra por sí sola autenticidad, vigencia ni validez del documento.

## Respaldo y restauración

Los documentos utilizan el mismo almacenamiento protegido que el sistema ya incluye
en sus respaldos. Antes de una actualización escolar se debe ejecutar:

```powershell
.\scripts\respaldo-ahora.ps1
.\scripts\estado.ps1
```

La restauración debe comprobar base de datos y carpeta de documentos. Nunca se debe
usar `docker compose down -v` para actualizar.

## Verificación local realizada

El verificador `backend/scripts/verify-student-documents-api.js` crea datos de prueba
identificables, comprueba autenticación, permisos, carga, versiones, OCR, revisión
humana, firma, PDF y descarga, y finalmente elimina solo esos registros y archivos.
No modifica documentos reales del establecimiento.

## Controles presenciales pendientes

- Confirmar quiénes recibirán cada permiso documental.
- Revisar categorías, niveles de acceso y plantillas con Dirección.
- Probar incorporación y descarga desde los computadores autorizados del colegio.
- Definir el valor institucional y jurídico que se dará a cada tipo de firma.
- Acordar retención, archivado y revisión periódica de vencimientos.

