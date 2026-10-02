-- Inventario y préstamos internos. Es un módulo aditivo y no interviene en
-- matrícula, puntualidad, visitas, retiros ni documentos estudiantiles.

CREATE TABLE IF NOT EXISTS recursos_inventario (
  id_recurso BIGSERIAL PRIMARY KEY,
  nombre VARCHAR(180) NOT NULL,
  categoria VARCHAR(80) NOT NULL,
  codigo_interno VARCHAR(80),
  descripcion VARCHAR(1000),
  ubicacion VARCHAR(180),
  stock_total INT NOT NULL DEFAULT 1 CHECK (stock_total > 0 AND stock_total <= 10000),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
    CHECK (estado IN ('ACTIVO', 'MANTENCION', 'BAJA')),
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recursos_codigo_interno
  ON recursos_inventario (lower(codigo_interno))
  WHERE codigo_interno IS NOT NULL AND btrim(codigo_interno) <> '';
CREATE INDEX IF NOT EXISTS idx_recursos_catalogo
  ON recursos_inventario (estado, categoria, lower(nombre));

CREATE TABLE IF NOT EXISTS recursos_prestamos (
  id_prestamo BIGSERIAL PRIMARY KEY,
  id_recurso BIGINT NOT NULL REFERENCES recursos_inventario(id_recurso) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cantidad INT NOT NULL DEFAULT 1 CHECK (cantidad > 0 AND cantidad <= 10000),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'
    CHECK (estado IN ('ACTIVO', 'DEVUELTO', 'CANCELADO')),
  prestado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vence_en TIMESTAMPTZ,
  devuelto_en TIMESTAMPTZ,
  entregado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  recibido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  condicion_entrega VARCHAR(500),
  condicion_devolucion VARCHAR(500),
  observaciones VARCHAR(1000),
  motivo_cancelacion VARCHAR(500),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_recurso_prestamo_vencimiento CHECK (vence_en IS NULL OR vence_en > prestado_en),
  CONSTRAINT ck_recurso_prestamo_devolucion CHECK (
    (estado = 'DEVUELTO' AND devuelto_en IS NOT NULL)
    OR (estado <> 'DEVUELTO' AND devuelto_en IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recursos_prestamos_activos
  ON recursos_prestamos (id_recurso, vence_en)
  WHERE estado = 'ACTIVO';
CREATE INDEX IF NOT EXISTS idx_recursos_prestamos_usuario
  ON recursos_prestamos (usuario_id, prestado_en DESC);

CREATE TABLE IF NOT EXISTS recursos_solicitudes (
  id_solicitud BIGSERIAL PRIMARY KEY,
  id_recurso BIGINT NOT NULL REFERENCES recursos_inventario(id_recurso) ON DELETE RESTRICT,
  solicitante_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cantidad INT NOT NULL DEFAULT 1 CHECK (cantidad > 0 AND cantidad <= 10000),
  motivo VARCHAR(1000) NOT NULL,
  necesita_en DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'ENTREGADA', 'CANCELADA')),
  resuelto_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelto_en TIMESTAMPTZ,
  respuesta VARCHAR(1000),
  id_prestamo BIGINT REFERENCES recursos_prestamos(id_prestamo) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_recurso_solicitud_entregada CHECK (
    (estado = 'ENTREGADA' AND id_prestamo IS NOT NULL)
    OR (estado <> 'ENTREGADA' AND id_prestamo IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_recursos_solicitudes_estado
  ON recursos_solicitudes (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_recursos_solicitudes_usuario
  ON recursos_solicitudes (solicitante_id, creado_en DESC);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('resources.view', 'Recursos internos', 'Consultar recursos internos', 'Permite consultar el catálogo y los préstamos o solicitudes visibles para la cuenta.', 670, false),
  ('resources.request', 'Recursos internos', 'Solicitar recursos', 'Permite crear y cancelar solicitudes propias de recursos internos.', 671, false),
  ('resources.manage', 'Recursos internos', 'Administrar inventario y préstamos', 'Permite administrar catálogo, solicitudes, entregas y devoluciones con trazabilidad.', 672, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'resources.view'), ('admin', 'resources.request'), ('admin', 'resources.manage'),
  ('direccion', 'resources.view'), ('direccion', 'resources.request'), ('direccion', 'resources.manage'),
  ('secretaria', 'resources.view'), ('secretaria', 'resources.request'), ('secretaria', 'resources.manage'),
  ('inspector', 'resources.view'), ('inspector', 'resources.request'),
  ('convivencia', 'resources.view'), ('convivencia', 'resources.request'),
  ('documental', 'resources.view'), ('documental', 'resources.request')
ON CONFLICT DO NOTHING;
