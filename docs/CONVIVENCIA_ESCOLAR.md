# Módulo reservado de Convivencia Escolar

Estado local: implementado y validado en la rama `Testing`.

## Propósito

Convivencia Escolar es un dominio independiente para registrar y seguir situaciones
institucionales sin mezclar sus antecedentes con atrasos, visitas, retiros o matrícula.
La ficha conserva personas involucradas, actuaciones, documentos, revisiones y cierre.

## Acceso

El acceso nunca se obtiene por pertenecer genéricamente a Inspectoría, Dirección,
Secretaría o Portería. Se habilita mediante permisos explícitos:

| Permiso | Alcance |
|---|---|
| `convivencia.view` | Consultar bandeja, casos, personas, actuaciones y documentos listados |
| `convivencia.create` | Registrar la situación inicial y sus participantes |
| `convivencia.manage` | Editar metadatos y registrar personas o actuaciones |
| `convivencia.documents` | Adjuntar y descargar respaldos protegidos |
| `convivencia.close` | Cerrar y reabrir un caso con motivo obligatorio |

La migración entrega los cinco permisos solamente a `Administrador` y al nuevo perfil
reutilizable `Convivencia Escolar`. Una cuenta puede recibir una selección más acotada
desde Usuarios y permisos.

## Flujo institucional

1. Una cuenta autorizada registra la situación, fecha, categoría, prioridad, relato
   inicial y al menos una persona involucrada.
2. El sistema genera un código institucional `CE-año-correlativo`.
3. Durante la gestión se agregan estudiantes, personal o personas externas con el rol
   que cumplen en el caso.
4. La línea de tiempo admite medidas, entrevistas, mediaciones, acuerdos,
   seguimientos, derivaciones y revisiones, con participantes y resultado opcionales.
5. Una fecha de próxima revisión alimenta la bandeja de pendientes.
6. Los documentos PDF, PNG o JPG se almacenan fuera del acceso público y se descargan
   únicamente desde una ruta autenticada y autorizada.
7. El cierre exige un motivo y bloquea nuevas modificaciones. Una reapertura exige otro
   motivo y devuelve el caso a seguimiento.

No existe eliminación de casos ni actuaciones desde la API. El historial se conserva.

## Protección y trazabilidad

- Cada ruta valida sesión y permiso en backend; ocultar un botón no es el control de seguridad.
- Las respuestas llevan `Cache-Control: no-store`.
- Los archivos no se publican como recursos estáticos.
- La auditoría general registra códigos, tipos, cantidades e identificadores técnicos.
  No copia el relato inicial, entrevistas, resultados ni motivos sensibles.
- Crear, editar, agregar personas, registrar actuaciones, adjuntar o descargar archivos,
  cerrar y reabrir generan eventos de auditoría.
- Un caso cerrado o anulado rechaza nuevas personas, actuaciones y documentos.
- Las actualizaciones de metadatos usan una versión para detectar edición concurrente.

## Modelo aditivo

La migración `033_convivencia_escolar.sql` crea exclusivamente:

- `convivencia_casos`
- `convivencia_participantes`
- `convivencia_eventos`
- `convivencia_evento_participantes`
- `convivencia_documentos`

No elimina ni altera columnas de atrasos, estudiantes, matrículas, visitas o retiros.

## Validación local automatizada

```powershell
cd backend
npm run check
npm test

cd ..
docker compose up -d --build backend frontend
docker compose exec -T backend npm run test:coexistence-api
docker compose ps
```

La prueba de integración crea un caso identificado como prueba, recorre acceso
restringido, alta, participantes, actuación, archivo, cierre y reapertura, y elimina
únicamente ese registro y su archivo temporal al finalizar.

## Prueba funcional pendiente antes de uso real

En un navegador del establecimiento se debe confirmar con una cuenta de prueba:

1. Administrador ve el módulo y una cuenta no autorizada no lo ve ni puede abrirlo.
2. El perfil Convivencia Escolar se puede asignar desde Usuarios y permisos.
3. Crear un caso con estudiante, integrante del personal y persona externa.
4. Registrar al menos una actuación de cada tipo.
5. Adjuntar y descargar un documento de prueba.
6. Cerrar, comprobar el bloqueo y reabrir el caso.
7. Revisar el recorrido de ayuda y las vistas de escritorio y celular.

No deben utilizarse antecedentes reales de estudiantes durante esta aceptación.
