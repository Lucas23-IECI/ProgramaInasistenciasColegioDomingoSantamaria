import { useMemo } from "react";
import axios from "axios";
import { BarcodeFormat, QRCodeWriter } from "@zxing/library";
import {
  AlertTriangle,
  Badge,
  Building2,
  Car,
  CheckCircle2,
  ClockAlert,
  Package,
  Printer,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { API_URL } from "../../config";
import { useFeedback } from "../../context/FeedbackContext";
import useVisitsExtendedOperations from "./useVisitsExtendedOperations";

const QR = ({ value }) => {
  const cells = useMemo(() => {
    if (!value) return null;
    // ZXing espera siempre un mapa de opciones. Si se omite, el escritor
    // intenta leer `.get` sobre `undefined` y derriba la vista de credencial.
    const matrix = new QRCodeWriter().encode(
      value,
      BarcodeFormat.QR_CODE,
      1,
      1,
      new Map(),
    );
    const output = [];
    for (let y = 0; y < matrix.getHeight(); y += 1)
      for (let x = 0; x < matrix.getWidth(); x += 1)
        if (matrix.get(x, y)) output.push([x, y]);
    return { output, size: matrix.getWidth() };
  }, [value]);
  if (!cells) return null;
  return (
    <svg
      className="extended-qr"
      viewBox={`-2 -2 ${cells.size + 4} ${cells.size + 4}`}
      aria-label="Código QR temporal"
    >
      <rect
        x="-2"
        y="-2"
        width={cells.size + 4}
        height={cells.size + 4}
        fill="#fff"
      />
      {cells.output.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="1"
          height="1"
          fill="#102b3b"
        />
      ))}
    </svg>
  );
};

export default function VisitsExtendedPanel({
  catalogs,
  permissions,
  activeVisits = [],
}) {
  const { confirm } = useFeedback();
  const {
    section, setSection, data, loading, saving, form, setForm, credential,
    setCredential, qrToken, setQrToken, qrResult, setQrResult, delivery, setDelivery,
    vehicle, setVehicle, vehicleLink, setVehicleLink, entity, setEntity,
    visitorQuery, setVisitorQuery, visitorResults, setVisitorResults, restriction, setRestriction,
    point, setPoint, emergency, setEmergency, load, run, createPreregistration,
    validateQr, useQr, saveDelivery, saveVehicle, linkVehicle, saveEntity,
    saveRestriction, updateVisitor, cancelPreregistration,
  } = useVisitsExtendedOperations({ permissions });

  const sections = [
    ["resumen", "Resumen", Users],
    permissions.prereg && ["esperadas", "Visitas esperadas", QrCode],
    permissions.restrictions && ["restricciones", "Restricciones", ShieldAlert],
    permissions.deliveries && ["encomiendas", "Encomiendas", Package],
    permissions.vehicles && ["vehiculos", "Vehículos", Car],
    permissions.emergency && ["emergencia", "Emergencia", AlertTriangle],
  ].filter(Boolean);
  const metric = (value, label, icon) => (
    <article>
      <span>{icon}</span>
      <strong>{value ?? 0}</strong>
      <small>{label}</small>
    </article>
  );

  return (
    <section className="extended-operations">
      <header>
        <div>
          <span className="section-kicker">Portería ampliada</span>
          <h2>Operación y seguridad de acceso</h2>
          <p>
            Visitas esperadas, proveedores, vehículos, entregas y ocupación de
            emergencia en un solo flujo.
          </p>
        </div>
        <button
          type="button"
          className="secondary-action"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw size={17} /> Actualizar
        </button>
      </header>
      <nav>
        {sections.map(([id, label, Icon]) => (
          <button
            type="button"
            key={id}
            data-active={section === id || undefined}
            onClick={() => setSection(id)}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>
      {loading ? (
        <div className="visit-empty">Cargando operación…</div>
      ) : (
        <>
          {section === "resumen" && (
            <>
              <div className="extended-metrics">
                {metric(
                  data.summary.personas_dentro,
                  "Personas dentro",
                  <Users />,
                )}
                {metric(
                  data.summary.visitas_esperadas,
                  "Visitas esperadas",
                  <Badge />,
                )}
                {metric(
                  data.summary.permanencias_excedidas,
                  "Permanencias excedidas",
                  <ClockAlert />,
                )}
                {metric(
                  data.summary.encomiendas_pendientes,
                  "Encomiendas pendientes",
                  <Package />,
                )}
                {metric(
                  data.summary.restricciones_vigentes,
                  "Restricciones vigentes",
                  <ShieldAlert />,
                )}
                {metric(
                  data.summary.emergencia_activa_id ? 1 : 0,
                  "Emergencia activa",
                  <AlertTriangle />,
                )}
              </div>
              <div className="extended-grid">
                <div>
                  <h3>Permanencias excedidas</h3>
                  {data.overdue.length ? (
                    data.overdue.map((item) => (
                      <article className="extended-row" key={item.id}>
                        <div>
                          <strong>{item.nombre_completo}</strong>
                          <small>
                            {item.destino_nombre} · {item.minutos_excedidos} min
                            adicionales
                          </small>
                        </div>
                        <span>{item.documento_mostrado}</span>
                      </article>
                    ))
                  ) : (
                    <p className="extended-empty-copy">
                      No hay permanencias excedidas.
                    </p>
                  )}
                </div>
                <div>
                  <h3>Personas frecuentes</h3>
                  {data.frequent.length ? (
                    data.frequent.map((item) => (
                      <article className="extended-row" key={item.id}>
                        <div>
                          <strong>{item.nombre_completo}</strong>
                          <small>
                            {item.entidad_nombre || "Sin entidad"} ·{" "}
                            {item.total_visitas} visitas
                          </small>
                        </div>
                        {permissions.settings ? (
                          <button
                            type="button"
                            className="secondary-action"
                            onClick={() => updateVisitor(item, false)}
                          >
                            Quitar marca
                          </button>
                        ) : (
                          <span>{item.documento_mostrado}</span>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="extended-empty-copy">
                      Aún no hay personas marcadas como frecuentes.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {section === "esperadas" && (
            <div className="extended-grid">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createPreregistration();
                }}
              >
                <h3>Preinscribir visita</h3>
                <div className="extended-form-grid">
                  <input
                    placeholder="Nombre completo"
                    value={form.visitante.nombre_completo}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        visitante: {
                          ...form.visitante,
                          nombre_completo: event.target.value,
                        },
                      })
                    }
                    required
                  />
                  <input
                    placeholder="RUT o documento"
                    value={form.visitante.documento}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        visitante: {
                          ...form.visitante,
                          documento: event.target.value,
                        },
                      })
                    }
                    required
                  />
                  <select
                    value={form.visitante.tipo_documento}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        visitante: {
                          ...form.visitante,
                          tipo_documento: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="RUT">RUT</option>
                    <option value="PASAPORTE">Pasaporte</option>
                    <option value="OTRO">Otro documento</option>
                  </select>
                  <input
                    placeholder="Teléfono opcional"
                    value={form.visitante.telefono}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        visitante: {
                          ...form.visitante,
                          telefono: event.target.value,
                        },
                      })
                    }
                  />
                  <select
                    value={form.motivo_codigo}
                    onChange={(event) =>
                      setForm({ ...form, motivo_codigo: event.target.value })
                    }
                    required
                  >
                    <option value="">Motivo</option>
                    {catalogs.motivos.map((item) => (
                      <option value={item.codigo} key={item.codigo}>
                        {item.nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    value={form.destino_codigo}
                    onChange={(event) =>
                      setForm({ ...form, destino_codigo: event.target.value })
                    }
                    required
                  >
                    <option value="">Destino</option>
                    {catalogs.destinos.map((item) => (
                      <option value={item.codigo} key={item.codigo}>
                        {item.nombre}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Persona anfitriona"
                    value={form.persona_contactada}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        persona_contactada: event.target.value,
                      })
                    }
                    required
                  />
                  <select
                    value={form.categoria}
                    onChange={(event) =>
                      setForm({ ...form, categoria: event.target.value })
                    }
                  >
                    <option value="VISITA">Visita</option>
                    <option value="PROVEEDOR">Proveedor</option>
                    <option value="CONTRATISTA">Contratista</option>
                  </select>
                  {(form.categoria === "PROVEEDOR" ||
                    form.categoria === "CONTRATISTA") && (
                    <select
                      value={form.entidad_externa_id}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          entidad_externa_id: event.target.value,
                        })
                      }
                    >
                      <option value="">Entidad no registrada</option>
                      {data.entities
                        .filter((item) => item.activo)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.nombre}
                          </option>
                        ))}
                    </select>
                  )}
                  <label>
                    Válida desde
                    <input
                      type="datetime-local"
                      value={form.valida_desde}
                      onChange={(event) =>
                        setForm({ ...form, valida_desde: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Válida hasta
                    <input
                      type="datetime-local"
                      value={form.valida_hasta}
                      onChange={(event) =>
                        setForm({ ...form, valida_hasta: event.target.value })
                      }
                      required
                    />
                  </label>
                </div>
                <button className="primary-action" disabled={saving}>
                  Crear credencial temporal
                </button>
              </form>
              <div>
                <h3>Validar ingreso con QR</h3>
                <input
                  placeholder="Escanear o pegar código de la credencial"
                  value={qrToken}
                  onChange={(event) => {
                    setQrToken(event.target.value);
                    setQrResult(null);
                  }}
                />
                <button
                  type="button"
                  className="secondary-action"
                  disabled={saving || qrToken.length < 20}
                  onClick={validateQr}
                >
                  Validar credencial
                </button>
                {qrResult && (
                  <article
                    className={`qr-validation ${qrResult.utilizable ? "is-valid" : "is-invalid"}`}
                  >
                    <strong>{qrResult.nombre_completo}</strong>
                    <span>
                      {qrResult.destino_nombre} · {qrResult.documento_mostrado}
                    </span>
                    <p>
                      {qrResult.utilizable
                        ? "Credencial vigente y disponible."
                        : "La credencial no puede utilizarse."}
                    </p>
                    {qrResult.restricciones?.length > 0 && (
                      <p>
                        {qrResult.restricciones.length} restricción(es)
                        requieren revisión.
                      </p>
                    )}
                    {qrResult.utilizable && permissions.view && (
                      <button
                        type="button"
                        className="primary-action"
                        onClick={useQr}
                      >
                        Confirmar entrada
                      </button>
                    )}
                  </article>
                )}
                <h3>Visitas esperadas</h3>
                {data.preregistrations.map((item) => (
                  <article className="extended-row" key={item.id}>
                    <div>
                      <strong>{item.nombre_completo}</strong>
                      <small>
                        {item.destino_nombre} · {item.estado}
                      </small>
                    </div>
                    <div className="extended-row__actions">
                      <span>
                        {new Date(item.valida_desde).toLocaleString("es-CL")}
                      </span>
                      {item.estado === "ESPERADA" && (
                        <button
                          type="button"
                          className="danger-action"
                          onClick={() => cancelPreregistration(item)}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {section === "restricciones" && (
            <div className="extended-grid">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveRestriction();
                }}
              >
                <h3>Nueva restricción</h3>
                <input
                  placeholder="Buscar persona por nombre o documento"
                  value={visitorQuery}
                  onChange={(event) => setVisitorQuery(event.target.value)}
                />
                {visitorResults.length > 0 && !restriction.visitante && (
                  <div className="extended-search-results">
                    {visitorResults.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => {
                          setRestriction({ ...restriction, visitante: item });
                          setVisitorQuery(item.nombre_completo);
                          setVisitorResults([]);
                        }}
                      >
                        <strong>{item.nombre_completo}</strong>
                        <small>{item.documento_mostrado}</small>
                      </button>
                    ))}
                  </div>
                )}
                {restriction.visitante && (
                  <div className="extended-selected">
                    <CheckCircle2 size={18} />
                    <span>
                      <strong>{restriction.visitante.nombre_completo}</strong>
                      <small>{restriction.visitante.documento_mostrado}</small>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRestriction({ ...restriction, visitante: null })
                      }
                    >
                      Cambiar
                    </button>
                  </div>
                )}
                <select
                  value={restriction.tipo}
                  onChange={(event) =>
                    setRestriction({ ...restriction, tipo: event.target.value })
                  }
                >
                  <option value="ALERTA">Alerta informativa</option>
                  <option value="REQUIERE_AUTORIZACION">
                    Requiere autorización
                  </option>
                  <option value="BLOQUEO">Bloqueo de acceso</option>
                </select>
                <textarea
                  placeholder="Motivo institucional de la restricción"
                  value={restriction.motivo}
                  onChange={(event) =>
                    setRestriction({
                      ...restriction,
                      motivo: event.target.value,
                    })
                  }
                  required
                />
                <label>
                  Vigente hasta (opcional)
                  <input
                    type="datetime-local"
                    value={restriction.vigente_hasta}
                    onChange={(event) =>
                      setRestriction({
                        ...restriction,
                        vigente_hasta: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="extended-inline-actions">
                  <button
                    className="primary-action"
                    disabled={saving || !restriction.visitante}
                  >
                    Registrar restricción
                  </button>
                  {restriction.visitante && permissions.settings && (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => updateVisitor(restriction.visitante, true)}
                    >
                      Marcar frecuente
                    </button>
                  )}
                </div>
              </form>
              <div>
                <h3>Restricciones registradas</h3>
                {data.restrictions.map((item) => (
                  <article className="extended-row" key={item.id}>
                    <div>
                      <strong>{item.nombre_completo}</strong>
                      <small>
                        {item.tipo.replaceAll("_", " ")} · {item.motivo}
                      </small>
                    </div>
                    {item.activo ? (
                      <button
                        type="button"
                        className="danger-action"
                        onClick={async () => {
                          const accepted = await confirm({
                            title: "Desactivar restricción",
                            message:
                              "La persona seguirá en el historial y la acción quedará auditada.",
                            confirmLabel: "Desactivar",
                          });
                          if (accepted)
                            run(
                              () =>
                                axios.patch(
                                  `${API_URL}/visitas/restricciones-acceso/${item.id}/desactivar`,
                                  {
                                    motivo:
                                      "Restricción desactivada después de revisión institucional.",
                                  },
                                ),
                              "Restricción desactivada.",
                            );
                        }}
                      >
                        Desactivar
                      </button>
                    ) : (
                      <span>Inactiva</span>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          {section === "encomiendas" && (
            <div className="extended-grid">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDelivery();
                }}
              >
                <h3>Registrar recepción</h3>
                {["remitente", "destinatario", "descripcion"].map((key) => (
                  <input
                    key={key}
                    placeholder={key[0].toUpperCase() + key.slice(1)}
                    value={delivery[key]}
                    onChange={(event) =>
                      setDelivery({ ...delivery, [key]: event.target.value })
                    }
                    required
                  />
                ))}
                <button className="primary-action" disabled={saving}>
                  Recibir encomienda
                </button>
              </form>
              <div>
                <h3>Pendientes</h3>
                {data.deliveries
                  .filter((item) => item.estado === "RECIBIDA")
                  .map((item) => (
                    <article className="extended-row" key={item.id}>
                      <div>
                        <strong>{item.destinatario}</strong>
                        <small>
                          {item.remitente} · {item.descripcion}
                        </small>
                      </div>
                      <button
                        className="secondary-action"
                        onClick={() =>
                          run(
                            () =>
                              axios.patch(
                                `${API_URL}/visitas/encomiendas/${item.id}/entregar`,
                              ),
                            "Entrega confirmada.",
                          )
                        }
                      >
                        Entregar
                      </button>
                    </article>
                  ))}
              </div>
            </div>
          )}

          {section === "vehiculos" && (
            <div className="extended-grid">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveVehicle();
                }}
              >
                <h3>Registrar vehículo</h3>
                <select
                  value={vehicle.tipo}
                  onChange={(event) =>
                    setVehicle({ ...vehicle, tipo: event.target.value })
                  }
                >
                  <option value="AUTOMOVIL">Automóvil</option>
                  <option value="CAMIONETA">Camioneta</option>
                  <option value="CAMION">Camión</option>
                  <option value="MOTOCICLETA">Motocicleta</option>
                  <option value="OTRO">Otro</option>
                </select>
                {["patente", "marca", "modelo", "color"].map((key) => (
                  <input
                    key={key}
                    placeholder={key[0].toUpperCase() + key.slice(1)}
                    value={vehicle[key]}
                    onChange={(event) =>
                      setVehicle({ ...vehicle, [key]: event.target.value })
                    }
                    required={key === "patente"}
                  />
                ))}
                <button className="primary-action" disabled={saving}>
                  Guardar vehículo
                </button>
              </form>
              <div>
                <h3>Directorio de vehículos</h3>
                {data.vehicles.map((item) => (
                  <article className="extended-row" key={item.id}>
                    <div>
                      <strong>{item.patente}</strong>
                      <small>
                        {[item.marca, item.modelo, item.color]
                          .filter(Boolean)
                          .join(" · ") || item.tipo}
                      </small>
                    </div>
                    <span>{item.total_movimientos} movimientos</span>
                  </article>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  linkVehicle();
                }}
              >
                <h3>Vincular a una visita activa</h3>
                <select
                  value={vehicleLink.visita_id}
                  onChange={(event) =>
                    setVehicleLink({ ...vehicleLink, visita_id: event.target.value })
                  }
                  required
                >
                  <option value="">Seleccionar visita</option>
                  {activeVisits.map((visit) => (
                    <option key={visit.id} value={visit.id}>
                      {visit.nombre_completo} · {visit.destino_nombre}
                    </option>
                  ))}
                </select>
                <select
                  value={vehicleLink.vehiculo_id}
                  onChange={(event) =>
                    setVehicleLink({ ...vehicleLink, vehiculo_id: event.target.value })
                  }
                  required
                >
                  <option value="">Seleccionar vehículo</option>
                  {data.vehicles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.patente} · {item.tipo}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-action"
                  disabled={saving || !activeVisits.length || !data.vehicles.length}
                >
                  Vincular vehículo
                </button>
                {!activeVisits.length && (
                  <p className="extended-empty-copy">
                    No hay visitas actualmente dentro del establecimiento.
                  </p>
                )}
              </form>
              {permissions.settings && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveEntity();
                  }}
                >
                  <h3>Proveedor o contratista</h3>
                  <select
                    value={entity.tipo}
                    onChange={(event) =>
                      setEntity({ ...entity, tipo: event.target.value })
                    }
                  >
                    <option value="PROVEEDOR">Proveedor</option>
                    <option value="CONTRATISTA">Contratista</option>
                    <option value="OTRA">Otra entidad</option>
                  </select>
                  <input
                    placeholder="Nombre de la entidad"
                    value={entity.nombre}
                    onChange={(event) =>
                      setEntity({ ...entity, nombre: event.target.value })
                    }
                    required
                  />
                  <input
                    placeholder="RUT o referencia"
                    value={entity.identificador}
                    onChange={(event) =>
                      setEntity({
                        ...entity,
                        identificador: event.target.value,
                      })
                    }
                  />
                  <button className="primary-action" disabled={saving}>
                    Guardar entidad
                  </button>
                </form>
              )}
            </div>
          )}

          {section === "emergencia" && (
            <div className="extended-grid">
              <div className="emergency-board">
                <h3>
                  {data.emergency?.emergencia
                    ? `Evento activo: ${data.emergency.emergencia.descripcion}`
                    : "No hay una emergencia activa"}
                </h3>
                {data.emergency?.personas?.map((item) => (
                  <article className="extended-row" key={item.visita_id}>
                    <div>
                      <strong>{item.nombre_completo}</strong>
                      <small>
                        {item.destino_nombre} · {item.estado}
                      </small>
                    </div>
                    {permissions.emergencyManage &&
                      item.estado === "PENDIENTE" && (
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() =>
                            run(
                              () =>
                                axios.patch(
                                  `${API_URL}/visitas/emergencias/${data.emergency.emergencia.id}/personas/${item.visita_id}`,
                                  {
                                    estado: "CONFIRMADO",
                                    punto_reunion_id:
                                      data.emergency.emergencia
                                        .punto_reunion_id,
                                  },
                                ),
                              "Persona confirmada en el punto de reunión.",
                            )
                          }
                        >
                          Confirmar
                        </button>
                      )}
                  </article>
                ))}
              </div>
              {permissions.emergencyManage && (
                <div>
                  <h3>Gestión de emergencia</h3>
                  {!data.emergency?.emergencia ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(
                          () =>
                            axios.post(
                              `${API_URL}/visitas/emergencias`,
                              emergency,
                            ),
                          "Evento iniciado con la ocupación actual.",
                        );
                      }}
                    >
                      <select
                        value={emergency.tipo}
                        onChange={(event) =>
                          setEmergency({
                            ...emergency,
                            tipo: event.target.value,
                          })
                        }
                      >
                        <option value="SIMULACRO">Simulacro</option>
                        <option value="EVACUACION">Evacuación</option>
                        <option value="OTRA">Otra emergencia</option>
                      </select>
                      <select
                        value={emergency.punto_reunion_id}
                        onChange={(event) =>
                          setEmergency({
                            ...emergency,
                            punto_reunion_id: event.target.value,
                          })
                        }
                      >
                        <option value="">Sin punto predeterminado</option>
                        {data.points.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.nombre}
                          </option>
                        ))}
                      </select>
                      <textarea
                        placeholder="Descripción del evento"
                        value={emergency.descripcion}
                        onChange={(event) =>
                          setEmergency({
                            ...emergency,
                            descripcion: event.target.value,
                          })
                        }
                      />
                      <button className="danger-action" disabled={saving}>
                        Iniciar evento
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={async () => {
                        const accepted = await confirm({
                          title: "Cerrar evento de emergencia",
                          message:
                            "Se conservará el registro de todas las verificaciones.",
                          confirmLabel: "Cerrar evento",
                        });
                        if (accepted)
                          run(
                            () =>
                              axios.patch(
                                `${API_URL}/visitas/emergencias/${data.emergency.emergencia.id}/cerrar`,
                                {
                                  observaciones:
                                    "Evento revisado y cerrado por el responsable institucional.",
                                  confirmar_pendientes: true,
                                },
                              ),
                            "Evento de emergencia cerrado.",
                          );
                      }}
                    >
                      Cerrar evento
                    </button>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(
                        () =>
                          axios.post(
                            `${API_URL}/visitas/puntos-reunion`,
                            point,
                          ),
                        "Punto de reunión guardado.",
                        () =>
                          setPoint({ codigo: "", nombre: "", descripcion: "" }),
                      );
                    }}
                  >
                    <h3>Agregar punto de reunión</h3>
                    <input
                      placeholder="Código"
                      value={point.codigo}
                      onChange={(event) =>
                        setPoint({ ...point, codigo: event.target.value })
                      }
                    />
                    <input
                      placeholder="Nombre"
                      value={point.nombre}
                      onChange={(event) =>
                        setPoint({ ...point, nombre: event.target.value })
                      }
                    />
                    <button className="primary-action" disabled={saving}>
                      Guardar punto
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {credential && (
        <div className="visit-dialog-backdrop">
          <section className="visit-dialog visit-pass">
            <button
              type="button"
              className="visit-dialog__close"
              onClick={() => setCredential(null)}
            >
              ×
            </button>
            <span className="section-kicker">Credencial temporal</span>
            <h2>{credential.nombre}</h2>
            <QR value={credential.qr_payload} />
            <p>Visita a {credential.anfitrion}</p>
            <small>
              Válida hasta{" "}
              {new Date(credential.valida_hasta).toLocaleString("es-CL")}
            </small>
            <button className="primary-action" onClick={() => window.print()}>
              <Printer size={17} /> Imprimir credencial
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
