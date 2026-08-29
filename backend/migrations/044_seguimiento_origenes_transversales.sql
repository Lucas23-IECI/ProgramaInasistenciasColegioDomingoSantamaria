-- Señales transversales para completar Seguimiento Institucional.
-- Migración aditiva: no modifica ni elimina casos, estudiantes, documentos o
-- registros de Convivencia existentes.

INSERT INTO seguimiento_reglas (
  codigo, nombre, descripcion, tipo_senal, umbral, ventana_dias, prioridad,
  plazo_dias, activa, responsable_perfil_codigo, escalamiento_dias,
  notificar_responsable
) VALUES
  (
    'CONTACTO_FAMILIAR_INCOMPLETO',
    'Ficha familiar sin teléfono vigente',
    'Detecta estudiantes con personas autorizadas vigentes, pero sin un teléfono disponible para contacto institucional.',
    'FAMILIA', 1, NULL, 'MEDIA', 5, true, 'secretaria', 2, true
  ),
  (
    'DOCUMENTO_VENCIDO',
    'Documento estudiantil vencido',
    'Detecta documentos activos cuya fecha de vencimiento ya fue alcanzada.',
    'DOCUMENTOS', 1, NULL, 'ALTA', 2, true, 'secretaria', 1, true
  ),
  (
    'DOCUMENTO_POR_VENCER',
    'Documento próximo a vencer',
    'Detecta documentos activos que vencerán dentro de la ventana preventiva configurada.',
    'DOCUMENTOS', 1, 30, 'MEDIA', 5, true, 'secretaria', 2, true
  ),
  (
    'POSIBLE_DUPLICADO_ESTUDIANTE',
    'Posible ficha estudiantil duplicada',
    'Detecta fichas activas con nombre completo y fecha de nacimiento idénticos para revisión humana; nunca fusiona automáticamente.',
    'IDENTIDAD', 2, NULL, 'URGENTE', 1, true, 'secretaria', 0, true
  ),
  (
    'CONVIVENCIA_CRITICA',
    'Coordinación reservada de Convivencia',
    'Detecta casos activos de prioridad alta o urgente sin exponer su descripción reservada fuera del módulo autorizado.',
    'CONVIVENCIA', 1, NULL, 'URGENTE', 1, true, 'convivencia', 0, true
  )
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  tipo_senal = EXCLUDED.tipo_senal,
  umbral = EXCLUDED.umbral,
  ventana_dias = EXCLUDED.ventana_dias,
  prioridad = EXCLUDED.prioridad,
  plazo_dias = EXCLUDED.plazo_dias,
  responsable_perfil_codigo = EXCLUDED.responsable_perfil_codigo,
  escalamiento_dias = EXCLUDED.escalamiento_dias,
  notificar_responsable = EXCLUDED.notificar_responsable,
  actualizada_en = CURRENT_TIMESTAMP;

INSERT INTO seguimiento_regla_escalamiento_grupos (regla_codigo, grupo_codigo) VALUES
  ('CONTACTO_FAMILIAR_INCOMPLETO', 'INSPECTORIA'),
  ('DOCUMENTO_VENCIDO', 'EQUIPO_GESTION'),
  ('DOCUMENTO_POR_VENCER', 'EQUIPO_GESTION'),
  ('POSIBLE_DUPLICADO_ESTUDIANTE', 'EQUIPO_GESTION'),
  ('CONVIVENCIA_CRITICA', 'CONVIVENCIA'),
  ('CONVIVENCIA_CRITICA', 'EQUIPO_GESTION')
ON CONFLICT DO NOTHING;
