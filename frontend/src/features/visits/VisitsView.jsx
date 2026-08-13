import { createElement } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock3,
  ContactRound,
  DoorOpen,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  IdCard,
  LogOut,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import ModuleHeader from "../../components/ModuleHeader";
import AppSelect from "../../components/AppSelect";
import DateRangeField from "../../components/DateRangeField";
import {
  formatChilePhoneInput,
  formatDocumentInput,
} from "../../utils/personFormat";
import {
  getStudentIdentifier,
  getStudentIdentifierLabel,
} from "../../utils/studentFormat";
import {
  formatDateTime,
  formatDate,
  studentName,
  stateLabel,
  todayIso,
} from "./visitModel";
import VisitsExtendedPanel from "./VisitsExtendedPanel";

const Metric = ({ icon: Icon, value, label, tone, note, onClick }) => (
  <button
    type="button"
    className="visit-metric"
    data-tone={tone}
    onClick={onClick}
  >
    <span className="visit-metric__icon">
      {createElement(Icon, { size: 24 })}
    </span>
    <div>
      <strong>{value ?? "—"}</strong>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
    <ArrowRight className="visit-metric__arrow" size={17} aria-hidden="true" />
  </button>
);

const VisitorFields = ({
  value,
  onChange,
  onLookup,
  lookupLoading,
  matches,
  onSelect,
  idPrefix,
}) => {
  const update = (field, next) => onChange({ ...value, [field]: next });
  return (
    <fieldset className="visit-fieldset">
      <legend>
        <IdCard size={18} /> Identificación de la persona
      </legend>
      <div className="visit-form-grid visit-form-grid--identity">
        <label>
          <span>Tipo de documento</span>
          <AppSelect
            ariaLabel="Tipo de documento"
            value={value.tipo_documento}
            onChange={(next) =>
              onChange({
                ...value,
                tipo_documento: next,
                documento: formatDocumentInput(next, value.documento),
              })
            }
            options={[
              { value: "RUT", label: "RUT chileno" },
              { value: "PASAPORTE", label: "Pasaporte" },
              { value: "OTRO", label: "Otro documento" },
            ]}
          />
        </label>
        <label className="visit-document-field">
          <span>Número de documento</span>
          <div>
            <input
              id={`${idPrefix}-documento`}
              value={value.documento}
              onChange={(event) =>
                update(
                  "documento",
                  formatDocumentInput(value.tipo_documento, event.target.value),
                )
              }
              placeholder={
                value.tipo_documento === "RUT"
                  ? "12.345.678-5"
                  : "Documento completo"
              }
              autoComplete="off"
            />
            <button
              type="button"
              onClick={onLookup}
              disabled={lookupLoading || value.documento.trim().length < 3}
            >
              <Search size={17} /> {lookupLoading ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </label>
        <label>
          <span>Nombre completo</span>
          <input
            value={value.nombre_completo}
            onChange={(event) => update("nombre_completo", event.target.value)}
            placeholder="Nombre y apellidos"
            autoComplete="name"
          />
        </label>
        <label>
          <span>
            Teléfono <small>opcional</small>
          </span>
          <input
            value={value.telefono}
            onChange={(event) =>
              update("telefono", formatChilePhoneInput(event.target.value))
            }
            placeholder="+56 9 1234 5678"
            autoComplete="tel"
          />
        </label>
      </div>
      {matches.length > 0 && (
        <div
          className="visit-person-matches"
          role="listbox"
          aria-label="Personas encontradas"
        >
          <span>Coincidencias anteriores</span>
          {matches.map((person) => (
            <button
              type="button"
              key={person.id}
              onClick={() => onSelect(person)}
            >
              <UserRound size={17} />
              <span>
                <strong>{person.nombre_completo}</strong>
                <small>{person.documento_mostrado}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
      <p className="visit-privacy-note">
        <ShieldCheck size={16} /> Comprueba físicamente el documento. El sistema
        no guarda fotografías ni copias del carnet.
      </p>
    </fieldset>
  );
};

const ActionDialog = ({
  action,
  value,
  onChange,
  onCancel,
  onConfirm,
  saving,
}) => {
  if (!action) return null;
  return (
    <div className="visit-dialog-backdrop" onMouseDown={onCancel}>
      <section
        className="visit-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="visit-dialog__close"
          onClick={onCancel}
          aria-label="Cerrar"
        >
          <X size={20} />
        </button>
        <span className="section-kicker">{action.kicker}</span>
        <h2>{action.title}</h2>
        <p>{action.description}</p>
        <label>
          <span>{action.fieldLabel || "Motivo de la acción"}</span>
          <textarea
            rows={4}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        </label>
        <div className="visit-dialog__actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={action.danger ? "danger-action" : "primary-action"}
            onClick={onConfirm}
            disabled={saving || value.trim().length < action.minimum}
          >
            {saving ? "Guardando…" : action.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};

export function VisitsView(controller) {
  if (controller.loading) {
    return <div className="route-loader">Preparando control de visitas…</div>;
  }

  const {
    navigate,
    canView,
    canRegister,
    canCheckout,
    canManage,
    canRegisterWithdrawal,
    canApproveWithdrawal,
    canManageAuthorizations,
    canExport,
    canImportGuardians,
    canConfigure,
    extendedPermissions,
    canUseExtended,
    canSeeWithdrawals,
    tab,
    setTab,
    catalogs,
    summary,
    visits,
    withdrawals,
    refreshing,
    visitForm,
    setVisitForm,
    withdrawalForm,
    setWithdrawalForm,
    visitorMatches,
    setVisitorMatches,
    withdrawalVisitorMatches,
    setWithdrawalVisitorMatches,
    lookupLoading,
    savingVisit,
    savingWithdrawal,
    authorizationForm,
    setAuthorizationForm,
    authorizationMatches,
    setAuthorizationMatches,
    authorizationStudentQuery,
    setAuthorizationStudentQuery,
    authorizationStudentResults,
    authorizationStudentSearching,
    authorizationStudent,
    setAuthorizationStudent,
    authorizations,
    setAuthorizations,
    authorizationsLoading,
    savingAuthorization,
    studentQuery,
    setStudentQuery,
    studentResults,
    setStudentResults,
    studentSearching,
    selectedStudent,
    setSelectedStudent,
    historyQuery,
    setHistoryQuery,
    historyState,
    setHistoryState,
    action,
    setAction,
    actionReason,
    setActionReason,
    savingAction,
    reportPeriod,
    setReportPeriod,
    reportType,
    setReportType,
    exportingFormat,
    fetchData,
    selectAuthorizationStudent,
    lookupVisitor,
    submitVisit,
    registerCheckout,
    submitWithdrawal,
    submitAuthorization,
    openAction,
    executeAction,
    deliverStudent,
    filteredVisits,
    exportReport,
    handleLogout,
  } = controller;

  return (
    <div className="visits-page">
      <main className="visits-shell">
        <ModuleHeader
          icon={ContactRound}
          title="Visitas y retiros"
          description="Control de acceso de personas externas y retiros autorizados de estudiantes."
          onBack={() => navigate("/admin")}
          onLogout={handleLogout}
        >
          {canConfigure && (
            <button
              type="button"
              className="module-header__button"
              onClick={() => navigate("/admin/visitas/configuracion")}
            >
              <Settings2 size={15} /> Configurar
            </button>
          )}
          <button
            type="button"
            className="module-header__button"
            onClick={() => fetchData({ quiet: true })}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />{" "}
            Actualizar
          </button>
        </ModuleHeader>

        <section className="visits-overview" data-tour="visits-summary">
          <div className="visits-overview__heading">
            <div>
              <span className="section-kicker">Situación actual</span>
              <h2>Control de acceso del establecimiento</h2>
            </div>
            <span className="visits-live">
              <i /> Información en tiempo real
            </span>
          </div>
          <div className="visit-metrics">
            <Metric
              icon={UsersRound}
              value={summary?.dentro}
              label="Personas dentro"
              tone="blue"
              note="Requieren registrar salida"
              onClick={() => setTab("presentes")}
            />
            <Metric
              icon={DoorOpen}
              value={summary?.ingresos_hoy}
              label="Ingresos de hoy"
              tone="green"
              onClick={() => {
                setHistoryState("");
                setTab("historial");
              }}
            />
            <Metric
              icon={PackageCheck}
              value={summary?.salidas_hoy}
              label="Salidas confirmadas"
              tone="slate"
              onClick={() => {
                setHistoryState("FINALIZADA");
                setTab("historial");
              }}
            />
            <Metric
              icon={ShieldAlert}
              value={summary?.retiros_pendientes}
              label="Retiros pendientes"
              tone="ochre"
              note="Requieren decisión"
              onClick={() => setTab("retiros")}
            />
          </div>
        </section>

        <nav
          className="visits-tabs"
          aria-label="Secciones del módulo"
          data-tour="visits-navigation"
        >
          {canView && (
            <button
              type="button"
              data-active={tab === "presentes" || undefined}
              onClick={() => setTab("presentes")}
            >
              <UsersRound size={19} /> Personas dentro
            </button>
          )}
          {canRegister && (
            <button
              type="button"
              data-active={tab === "registrar" || undefined}
              onClick={() => setTab("registrar")}
            >
              <DoorOpen size={19} /> Registrar visita
            </button>
          )}
          {canSeeWithdrawals && (
            <button
              type="button"
              data-active={tab === "retiros" || undefined}
              onClick={() => setTab("retiros")}
            >
              <UserCheck size={19} /> Retiros
            </button>
          )}
          {canRegisterWithdrawal && (
            <button
              type="button"
              data-active={tab === "solicitar-retiro" || undefined}
              onClick={() => setTab("solicitar-retiro")}
            >
              <BadgeCheck size={19} /> Solicitar retiro
            </button>
          )}
          {canManageAuthorizations && (
            <button
              type="button"
              data-active={tab === "autorizaciones" || undefined}
              onClick={() => setTab("autorizaciones")}
            >
              <ShieldCheck size={19} /> Autorizaciones
            </button>
          )}
          {canView && (
            <button
              type="button"
              data-active={tab === "historial" || undefined}
              onClick={() => setTab("historial")}
            >
              <History size={19} /> Historial
            </button>
          )}
          {canExport && (
            <button
              type="button"
              data-active={tab === "reportes" || undefined}
              onClick={() => setTab("reportes")}
            >
              <FileText size={19} /> Reportes
            </button>
          )}
          {canUseExtended && (
            <button
              type="button"
              data-active={tab === "operacion-ampliada" || undefined}
              onClick={() => setTab("operacion-ampliada")}
            >
              <PackageCheck size={19} /> Operación ampliada
            </button>
          )}
        </nav>

        {tab === "operacion-ampliada" && canUseExtended && (
          <VisitsExtendedPanel
            catalogs={catalogs}
            permissions={extendedPermissions}
            activeVisits={visits.filter((visit) => visit.estado === "DENTRO")}
          />
        )}

        {tab === "registrar" && canRegister && (
          <form
            className="visit-workspace"
            onSubmit={submitVisit}
            data-tour="visit-register"
          >
            <div className="visit-workspace__header">
              <div>
                <span className="section-kicker">Nueva entrada</span>
                <h2>Registrar una visita</h2>
                <p>
                  Busca una ficha anterior o crea una nueva usando los datos
                  mínimos del documento.
                </p>
              </div>
              <span className="visit-step">1 de 2 · Persona y destino</span>
            </div>
            <VisitorFields
              value={visitForm.visitante}
              onChange={(visitante) =>
                setVisitForm((current) => ({ ...current, visitante }))
              }
              onLookup={() =>
                lookupVisitor(
                  visitForm.visitante,
                  (visitante) =>
                    setVisitForm((current) => ({ ...current, visitante })),
                  setVisitorMatches,
                )
              }
              lookupLoading={lookupLoading}
              matches={visitorMatches}
              onSelect={(person) => {
                setVisitForm((current) => ({
                  ...current,
                  visitante: {
                    tipo_documento: person.tipo_documento,
                    documento: person.documento,
                    nombre_completo: person.nombre_completo,
                    telefono: person.telefono || "",
                  },
                }));
                setVisitorMatches([]);
              }}
              idPrefix="visit"
            />
            <fieldset className="visit-fieldset">
              <legend>
                <MapPin size={18} /> Motivo y destino
              </legend>
              <div className="visit-form-grid">
                <label>
                  <span>Motivo</span>
                  <AppSelect
                    ariaLabel="Motivo de la visita"
                    value={visitForm.motivo_codigo}
                    onChange={(value) =>
                      setVisitForm((current) => ({
                        ...current,
                        motivo_codigo: value,
                      }))
                    }
                    options={[
                      { value: "", label: "Seleccionar motivo" },
                      ...catalogs.motivos.map((item) => ({
                        value: item.codigo,
                        label: item.nombre,
                      })),
                    ]}
                  />
                </label>
                <label>
                  <span>Destino</span>
                  <AppSelect
                    ariaLabel="Destino de la visita"
                    value={visitForm.destino_codigo}
                    onChange={(value) =>
                      setVisitForm((current) => ({
                        ...current,
                        destino_codigo: value,
                      }))
                    }
                    options={[
                      { value: "", label: "Seleccionar dependencia" },
                      ...catalogs.destinos.map((item) => ({
                        value: item.codigo,
                        label: item.nombre,
                      })),
                    ]}
                  />
                </label>
                <label>
                  <span>
                    Persona contactada <small>opcional</small>
                  </span>
                  <input
                    value={visitForm.persona_contactada}
                    onChange={(event) =>
                      setVisitForm((current) => ({
                        ...current,
                        persona_contactada: event.target.value,
                      }))
                    }
                    placeholder="Ej: directora, docente o funcionario"
                  />
                </label>
                <label>
                  <span>
                    Salida estimada <small>opcional</small>
                  </span>
                  <input
                    type="datetime-local"
                    value={visitForm.salida_esperada_en}
                    onChange={(event) =>
                      setVisitForm((current) => ({
                        ...current,
                        salida_esperada_en: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>
                    Detalle del motivo{" "}
                    {visitForm.motivo_codigo === "OTRO" ? (
                      ""
                    ) : (
                      <small>opcional</small>
                    )}
                  </span>
                  <input
                    value={visitForm.motivo_detalle}
                    onChange={(event) =>
                      setVisitForm((current) => ({
                        ...current,
                        motivo_detalle: event.target.value,
                      }))
                    }
                    placeholder="Información breve para orientar la visita"
                  />
                </label>
              </div>
            </fieldset>
            <footer className="visit-workspace__footer">
              <p>
                <ShieldCheck size={18} /> La hora y el responsable se registran
                automáticamente.
              </p>
              <button
                type="submit"
                className="primary-action"
                disabled={savingVisit}
              >
                {savingVisit ? "Registrando…" : "Confirmar entrada"}{" "}
                <ArrowRight size={18} />
              </button>
            </footer>
          </form>
        )}

        {tab === "solicitar-retiro" && canRegisterWithdrawal && (
          <form
            className="visit-workspace"
            onSubmit={submitWithdrawal}
            data-tour="withdrawal-register"
          >
            <div className="visit-workspace__header">
              <div>
                <span className="section-kicker">Solicitud controlada</span>
                <h2>Retiro de estudiante</h2>
                <p>
                  Registrar la solicitud no autoriza la entrega. Inspectoría
                  debe revisarla y confirmarla.
                </p>
              </div>
              <span className="visit-step visit-step--warning">
                Requiere autorización
              </span>
            </div>
            <VisitorFields
              value={withdrawalForm.visitante}
              onChange={(visitante) =>
                setWithdrawalForm((current) => ({ ...current, visitante }))
              }
              onLookup={() =>
                lookupVisitor(
                  withdrawalForm.visitante,
                  (visitante) =>
                    setWithdrawalForm((current) => ({ ...current, visitante })),
                  setWithdrawalVisitorMatches,
                )
              }
              lookupLoading={lookupLoading}
              matches={withdrawalVisitorMatches}
              onSelect={(person) => {
                setWithdrawalForm((current) => ({
                  ...current,
                  visitante: {
                    tipo_documento: person.tipo_documento,
                    documento: person.documento,
                    nombre_completo: person.nombre_completo,
                    telefono: person.telefono || "",
                  },
                }));
                setWithdrawalVisitorMatches([]);
              }}
              idPrefix="withdrawal"
            />
            <fieldset className="visit-fieldset">
              <legend>
                <UserCheck size={18} /> Estudiante y motivo
              </legend>
              <div className="visit-student-search">
                <label>
                  <span>Buscar estudiante</span>
                  <div>
                    <Search size={18} />
                    <input
                      value={studentQuery}
                      onChange={(event) => {
                        setStudentQuery(event.target.value);
                        setSelectedStudent(null);
                      }}
                      placeholder="Nombre o RUT del estudiante"
                    />
                  </div>
                </label>
                {studentSearching && (
                  <span className="visit-searching">Buscando…</span>
                )}
                {!selectedStudent && studentResults.length > 0 && (
                  <div className="visit-student-results">
                    {studentResults.map((student) => (
                      <button
                        type="button"
                        key={student.id_alumno}
                        onClick={() => {
                          setSelectedStudent(student);
                          setStudentQuery(studentName(student));
                          setStudentResults([]);
                        }}
                      >
                        <UserRound size={18} />
                        <span>
                          <strong>{studentName(student)}</strong>
                          <small>
                            {student.nombre_curso || "Sin curso"} ·{" "}
                            {getStudentIdentifierLabel(student)}{" "}
                            {getStudentIdentifier(student)}
                          </small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                )}
                {selectedStudent && (
                  <div className="visit-selected-student">
                    <CheckCircle2 size={22} />
                    <span>
                      <strong>{studentName(selectedStudent)}</strong>
                      <small>
                        {selectedStudent.nombre_curso || "Sin curso"} ·{" "}
                        {getStudentIdentifierLabel(selectedStudent)}{" "}
                        {getStudentIdentifier(selectedStudent)}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStudent(null);
                        setStudentQuery("");
                      }}
                    >
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
              <div className="visit-form-grid visit-form-grid--withdrawal">
                <label>
                  <span>Relación con el estudiante</span>
                  <AppSelect
                    ariaLabel="Relación con el estudiante"
                    value={withdrawalForm.parentesco_declarado_codigo}
                    onChange={(value) =>
                      setWithdrawalForm((current) => ({
                        ...current,
                        parentesco_declarado_codigo: value,
                        parentesco_declarado_detalle:
                          value === "OTRO"
                            ? current.parentesco_declarado_detalle
                            : "",
                      }))
                    }
                    options={[
                      { value: "", label: "Seleccionar relación" },
                      ...catalogs.parentescos.map((item) => ({
                        value: item.codigo,
                        label: item.nombre,
                      })),
                    ]}
                  />
                </label>
                {withdrawalForm.parentesco_declarado_codigo === "OTRO" && (
                  <label>
                    <span>Especificar relación</span>
                    <input
                      value={withdrawalForm.parentesco_declarado_detalle}
                      onChange={(event) =>
                        setWithdrawalForm((current) => ({
                          ...current,
                          parentesco_declarado_detalle: event.target.value,
                        }))
                      }
                      placeholder="Ej: vecino autorizado por Inspectoría"
                    />
                  </label>
                )}
                <label>
                  <span>Motivo del retiro</span>
                  <AppSelect
                    ariaLabel="Motivo del retiro"
                    value={withdrawalForm.motivo_codigo}
                    onChange={(value) =>
                      setWithdrawalForm((current) => ({
                        ...current,
                        motivo_codigo: value,
                        motivo_detalle: "",
                      }))
                    }
                    options={[
                      { value: "", label: "Seleccionar motivo" },
                      ...catalogs.motivos_retiro.map((item) => ({
                        value: item.codigo,
                        label: item.nombre,
                      })),
                    ]}
                  />
                </label>
                <label
                  className={
                    withdrawalForm.parentesco_declarado_codigo === "OTRO"
                      ? ""
                      : "visit-grid-span-1"
                  }
                >
                  <span>
                    Justificación
                    {!catalogs.motivos_retiro.find(
                      (item) => item.codigo === withdrawalForm.motivo_codigo,
                    )?.requiere_detalle && <small>opcional</small>}
                  </span>
                  <textarea
                    rows={3}
                    value={withdrawalForm.motivo_detalle}
                    onChange={(event) =>
                      setWithdrawalForm((current) => ({
                        ...current,
                        motivo_detalle: event.target.value,
                      }))
                    }
                    placeholder="Antecedente breve informado por la persona responsable"
                  />
                </label>
              </div>
              <div className="visit-warning">
                <ShieldAlert size={22} />
                <div>
                  <strong>La coincidencia de RUT no autoriza la entrega</strong>
                  <span>
                    El sistema buscará una autorización vigente, pero una cuenta
                    habilitada deberá aprobar o rechazar la solicitud.
                  </span>
                </div>
              </div>
            </fieldset>
            <footer className="visit-workspace__footer">
              <p>
                <Clock3 size={18} /> La solicitud quedará pendiente hasta una
                decisión registrada.
              </p>
              <button
                type="submit"
                className="primary-action"
                disabled={savingWithdrawal}
              >
                {savingWithdrawal ? "Registrando…" : "Crear solicitud"}{" "}
                <ArrowRight size={18} />
              </button>
            </footer>
          </form>
        )}

        {tab === "autorizaciones" && canManageAuthorizations && (
          <form
            className="visit-workspace"
            onSubmit={submitAuthorization}
            data-tour="withdrawal-authorizations"
          >
            <div className="visit-workspace__header">
              <div>
                <span className="section-kicker">
                  Antecedente institucional
                </span>
                <h2>Personas autorizadas para retirar</h2>
                <p>
                  Registra únicamente autorizaciones respaldadas por la fuente
                  oficial definida por el establecimiento.
                </p>
              </div>
              <span className="visit-step">
                Estudiante y persona autorizada
              </span>
            </div>

            <fieldset className="visit-fieldset">
              <legend>
                <UserCheck size={18} /> Estudiante
              </legend>
              <div className="visit-student-search">
                <label>
                  <span>Buscar estudiante</span>
                  <div>
                    <Search size={18} />
                    <input
                      value={authorizationStudentQuery}
                      onChange={(event) => {
                        setAuthorizationStudentQuery(event.target.value);
                        setAuthorizationStudent(null);
                        setAuthorizations([]);
                      }}
                      placeholder="Nombre o RUT del estudiante"
                    />
                  </div>
                </label>
                {authorizationStudentSearching && (
                  <span className="visit-searching">Buscando…</span>
                )}
                {!authorizationStudent &&
                  authorizationStudentResults.length > 0 && (
                    <div className="visit-student-results">
                      {authorizationStudentResults.map((student) => (
                        <button
                          type="button"
                          key={student.id_alumno}
                          onClick={() => selectAuthorizationStudent(student)}
                        >
                          <UserRound size={18} />
                          <span>
                            <strong>{studentName(student)}</strong>
                            <small>
                              {student.nombre_curso || "Sin curso"} ·{" "}
                              {getStudentIdentifierLabel(student)}{" "}
                              {getStudentIdentifier(student)}
                            </small>
                          </span>
                          <ArrowRight size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                {authorizationStudent && (
                  <div className="visit-selected-student">
                    <CheckCircle2 size={22} />
                    <span>
                      <strong>{studentName(authorizationStudent)}</strong>
                      <small>
                        {authorizationStudent.nombre_curso || "Sin curso"} ·{" "}
                        {getStudentIdentifierLabel(authorizationStudent)}{" "}
                        {getStudentIdentifier(authorizationStudent)}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthorizationStudent(null);
                        setAuthorizationStudentQuery("");
                        setAuthorizations([]);
                      }}
                    >
                      Cambiar
                    </button>
                  </div>
                )}
              </div>

              {authorizationStudent && (
                <div className="authorization-roster" aria-live="polite">
                  <header>
                    <strong>Autorizaciones vigentes registradas</strong>
                    <span>
                      {authorizationsLoading
                        ? "Consultando…"
                        : `${authorizations.length} persona${authorizations.length === 1 ? "" : "s"}`}
                    </span>
                  </header>
                  {!authorizationsLoading && authorizations.length === 0 && (
                    <p>
                      No hay personas autorizadas cargadas para este estudiante.
                    </p>
                  )}
                  {authorizations.map((authorization) => (
                    <article key={authorization.id}>
                      <span className="visit-avatar">
                        {authorization.visitante.nombre_completo
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      <div>
                        <strong>
                          {authorization.visitante.nombre_completo}
                        </strong>
                        <small>
                          {authorization.parentesco}
                          {authorization.parentesco_detalle
                            ? ` (${authorization.parentesco_detalle})`
                            : ""}
                          {" · "}
                          {authorization.visitante.documento_mostrado}
                        </small>
                      </div>
                      <div>
                        <span>
                          {authorization.es_principal
                            ? "Apoderado principal · "
                            : ""}
                          {authorization.origen_autorizacion}
                        </span>
                        <small>
                          Desde {formatDate(authorization.vigente_desde)}
                          {authorization.vigente_hasta
                            ? ` hasta ${formatDate(authorization.vigente_hasta)}`
                            : " · sin fecha final"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </fieldset>

            <VisitorFields
              value={authorizationForm.visitante}
              onChange={(visitante) =>
                setAuthorizationForm((current) => ({ ...current, visitante }))
              }
              onLookup={() =>
                lookupVisitor(
                  authorizationForm.visitante,
                  (visitante) =>
                    setAuthorizationForm((current) => ({
                      ...current,
                      visitante,
                    })),
                  setAuthorizationMatches,
                )
              }
              lookupLoading={lookupLoading}
              matches={authorizationMatches}
              onSelect={(person) => {
                setAuthorizationForm((current) => ({
                  ...current,
                  visitante: {
                    tipo_documento: person.tipo_documento,
                    documento: person.documento,
                    nombre_completo: person.nombre_completo,
                    telefono: person.telefono || "",
                  },
                }));
                setAuthorizationMatches([]);
              }}
              idPrefix="authorization"
            />

            <fieldset className="visit-fieldset">
              <legend>
                <ShieldCheck size={18} /> Respaldo y vigencia
              </legend>
              <div className="visit-form-grid">
                <label>
                  <span>Parentesco o relación</span>
                  <AppSelect
                    ariaLabel="Parentesco o relación"
                    value={authorizationForm.parentesco_codigo}
                    onChange={(value) =>
                      setAuthorizationForm((current) => ({
                        ...current,
                        parentesco_codigo: value,
                        parentesco_detalle:
                          value === "OTRO" ? current.parentesco_detalle : "",
                      }))
                    }
                    options={[
                      { value: "", label: "Seleccionar relación" },
                      ...catalogs.parentescos.map((item) => ({
                        value: item.codigo,
                        label: item.nombre,
                      })),
                    ]}
                  />
                </label>
                {authorizationForm.parentesco_codigo === "OTRO" && (
                  <label>
                    <span>Especificar relación</span>
                    <input
                      value={authorizationForm.parentesco_detalle}
                      onChange={(event) =>
                        setAuthorizationForm((current) => ({
                          ...current,
                          parentesco_detalle: event.target.value,
                        }))
                      }
                      placeholder="Describe la relación"
                    />
                  </label>
                )}
                <label>
                  <span>Origen de la autorización</span>
                  <input
                    value={authorizationForm.origen_autorizacion}
                    onChange={(event) =>
                      setAuthorizationForm((current) => ({
                        ...current,
                        origen_autorizacion: event.target.value,
                      }))
                    }
                    placeholder="Ej: ficha de matrícula 2026"
                  />
                </label>
                <label>
                  <span>
                    Vigente desde <small>opcional</small>
                  </span>
                  <input
                    type="date"
                    value={authorizationForm.vigente_desde}
                    onChange={(event) =>
                      setAuthorizationForm((current) => ({
                        ...current,
                        vigente_desde: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>
                    Vigente hasta <small>opcional</small>
                  </span>
                  <input
                    type="date"
                    value={authorizationForm.vigente_hasta}
                    onChange={(event) =>
                      setAuthorizationForm((current) => ({
                        ...current,
                        vigente_hasta: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="visit-check-field">
                  <input
                    type="checkbox"
                    checked={authorizationForm.es_principal}
                    onChange={(event) =>
                      setAuthorizationForm((current) => ({
                        ...current,
                        es_principal: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>Apoderado/a principal</strong>
                    <small>
                      Marca esta opción solo si la ficha oficial lo identifica
                      como principal.
                    </small>
                  </span>
                </label>
              </div>
              <div className="visit-warning">
                <ShieldAlert size={22} />
                <div>
                  <strong>
                    Esta ficha apoya la decisión, pero no entrega al estudiante
                    automáticamente
                  </strong>
                  <span>
                    Cada retiro seguirá requiriendo solicitud, aprobación y
                    confirmación final de entrega.
                  </span>
                </div>
              </div>
            </fieldset>

            <footer className="visit-workspace__footer">
              <p>
                <ShieldCheck size={18} /> La creación o actualización quedará
                registrada en auditoría.
              </p>
              <div className="visit-workspace__footer-actions">
                {canImportGuardians && (
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() =>
                      navigate("/admin/estudiantes?seccion=apoderados")
                    }
                  >
                    <FileSpreadsheet size={18} /> Importar ficha
                  </button>
                )}
                <button
                  type="submit"
                  className="primary-action"
                  disabled={savingAuthorization || !authorizationStudent}
                >
                  {savingAuthorization ? "Guardando…" : "Guardar autorización"}{" "}
                  <ArrowRight size={18} />
                </button>
              </div>
            </footer>
          </form>
        )}

        {tab === "reportes" && canExport && (
          <section className="visit-report-panel" data-tour="visits-reports">
            <header>
              <div>
                <span className="section-kicker">Documento institucional</span>
                <h2>Reportes de visitas y retiros</h2>
                <p>
                  Elige el período, el contenido y el formato. Los documentos
                  personales se exportan enmascarados.
                </p>
              </div>
            </header>
            <div className="visit-report-controls">
              <DateRangeField
                label="Período del reporte"
                from={reportPeriod.desde}
                to={reportPeriod.hasta}
                maxValue={todayIso()}
                onChange={(period) =>
                  setReportPeriod({ desde: period.from, hasta: period.to })
                }
              />
              <label>
                <span>Contenido</span>
                <AppSelect
                  ariaLabel="Contenido del reporte"
                  value={reportType}
                  onChange={setReportType}
                  options={[
                    { value: "TODO", label: "Visitas y retiros" },
                    { value: "VISITAS", label: "Solo visitas" },
                    { value: "RETIROS", label: "Solo retiros" },
                  ]}
                />
              </label>
            </div>
            <div
              className="visit-report-formats"
              aria-label="Formatos disponibles"
            >
              <button
                type="button"
                onClick={() => exportReport("xlsx")}
                disabled={Boolean(exportingFormat)}
              >
                <FileSpreadsheet size={22} />
                <span>
                  <strong>Excel</strong>
                  <small>Resumen y hojas separadas</small>
                </span>
                {exportingFormat === "xlsx" ? (
                  "Generando…"
                ) : (
                  <Download size={18} />
                )}
              </button>
              <button
                type="button"
                onClick={() => exportReport("pdf")}
                disabled={Boolean(exportingFormat)}
              >
                <FileText size={22} />
                <span>
                  <strong>PDF</strong>
                  <small>Informe listo para archivar</small>
                </span>
                {exportingFormat === "pdf" ? (
                  "Generando…"
                ) : (
                  <Download size={18} />
                )}
              </button>
              <button
                type="button"
                onClick={() => exportReport("md")}
                disabled={Boolean(exportingFormat)}
              >
                <FileText size={22} />
                <span>
                  <strong>Markdown</strong>
                  <small>Texto estructurado y portable</small>
                </span>
                {exportingFormat === "md" ? (
                  "Generando…"
                ) : (
                  <Download size={18} />
                )}
              </button>
            </div>
            <footer>
              <ShieldCheck size={19} />
              <span>
                Cada exportación registra cuenta, período, formato y cantidad de
                filas en auditoría.
              </span>
            </footer>
          </section>
        )}

        {(tab === "presentes" || tab === "historial") && canView && (
          <section className="visit-list-section" data-tour="visits-list">
            <header>
              <div>
                <span className="section-kicker">
                  {tab === "presentes" ? "Acceso vigente" : "Trazabilidad"}
                </span>
                <h2>
                  {tab === "presentes"
                    ? "Personas dentro del establecimiento"
                    : "Historial de visitas"}
                </h2>
                <p>{filteredVisits.length} registros visibles</p>
              </div>
              {canExport && tab === "historial" && (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setTab("reportes")}
                >
                  <Download size={17} /> Preparar reporte
                </button>
              )}
            </header>
            {tab === "historial" && (
              <div className="visit-list-filters">
                <label>
                  <Search size={18} />
                  <input
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="Nombre, documento, destino o persona"
                  />
                </label>
                <AppSelect
                  ariaLabel="Estado de la visita"
                  value={historyState}
                  onChange={setHistoryState}
                  options={[
                    { value: "", label: "Todos los estados" },
                    { value: "DENTRO", label: "Dentro" },
                    { value: "FINALIZADA", label: "Finalizadas" },
                    { value: "ANULADA", label: "Anuladas" },
                  ]}
                />
              </div>
            )}
            <div className="visit-records">
              {filteredVisits.length === 0 && (
                <div className="visit-empty">
                  <DoorOpen size={38} />
                  <strong>
                    {tab === "presentes"
                      ? "No hay visitas activas"
                      : "No hay registros con estos filtros"}
                  </strong>
                  <span>
                    Actualiza la información o cambia los criterios de búsqueda.
                  </span>
                </div>
              )}
              {filteredVisits.map((visit) => (
                <article className="visit-record" key={visit.id}>
                  <div className="visit-record__person">
                    <span className="visit-avatar">
                      {visit.visitante.nombre_completo
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <div>
                      <strong>{visit.visitante.nombre_completo}</strong>
                      <small>{visit.visitante.documento_mostrado}</small>
                    </div>
                  </div>
                  <div className="visit-record__route">
                    <span>
                      <MapPin size={15} /> {visit.destino_nombre}
                    </span>
                    <strong>{visit.motivo_nombre}</strong>
                    {visit.persona_contactada && (
                      <small>Busca a {visit.persona_contactada}</small>
                    )}
                  </div>
                  <div className="visit-record__time">
                    <span>Ingreso</span>
                    <strong>{formatDateTime(visit.ingreso_en)}</strong>
                    {visit.salida_en && (
                      <small>Salida {formatDateTime(visit.salida_en)}</small>
                    )}
                  </div>
                  <span className="visit-status" data-state={visit.estado}>
                    {stateLabel(visit.estado)}
                  </span>
                  <div className="visit-record__actions">
                    {visit.estado === "DENTRO" && canCheckout && (
                      <button
                        type="button"
                        className="primary-action"
                        onClick={() => registerCheckout(visit)}
                      >
                        <LogOut size={16} /> Registrar salida
                      </button>
                    )}
                    {!["ANULADA", "RECHAZADA"].includes(visit.estado) &&
                      canManage && (
                        <button
                          type="button"
                          className="icon-danger-action"
                          title="Anular visita"
                          onClick={() =>
                            openAction({
                              type: "annul-visit",
                              id: visit.id,
                              kicker: "Corrección institucional",
                              title: "Anular visita",
                              description: `La visita de ${visit.visitante.nombre_completo} quedará anulada, pero seguirá en auditoría.`,
                              fieldLabel: "Motivo de anulación",
                              minimum: 8,
                              confirmLabel: "Anular visita",
                              danger: true,
                            })
                          }
                        >
                          <Ban size={18} />
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "retiros" && canSeeWithdrawals && (
          <section className="visit-list-section" data-tour="withdrawals-list">
            <header>
              <div>
                <span className="section-kicker">Control de entrega</span>
                <h2>Solicitudes de retiro</h2>
                <p>
                  Las solicitudes pendientes y autorizadas aparecen primero.
                </p>
              </div>
              {canRegisterWithdrawal && (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setTab("solicitar-retiro")}
                >
                  <BadgeCheck size={17} /> Nueva solicitud
                </button>
              )}
            </header>
            <div className="withdrawal-records">
              {withdrawals.length === 0 && (
                <div className="visit-empty">
                  <UserCheck size={38} />
                  <strong>No hay solicitudes registradas</strong>
                  <span>
                    Las nuevas solicitudes aparecerán en esta sección.
                  </span>
                </div>
              )}
              {withdrawals.map((withdrawal) => (
                <article
                  className="withdrawal-record"
                  key={withdrawal.id}
                  data-state={withdrawal.estado}
                >
                  <div className="withdrawal-record__head">
                    <span
                      className="visit-status"
                      data-state={withdrawal.estado}
                    >
                      {stateLabel(withdrawal.estado)}
                    </span>
                    <span>{formatDateTime(withdrawal.solicitado_en)}</span>
                  </div>
                  <div className="withdrawal-record__people">
                    <div>
                      <span>Estudiante</span>
                      <strong>{studentName(withdrawal.estudiante)}</strong>
                      <small>
                        {withdrawal.estudiante.nombre_curso || "Sin curso"}
                      </small>
                    </div>
                    <ArrowRight size={22} />
                    <div>
                      <span>Persona que retira</span>
                      <strong>{withdrawal.visitante.nombre_completo}</strong>
                      <small>{withdrawal.visitante.documento_mostrado}</small>
                    </div>
                  </div>
                  <div className="withdrawal-record__reason">
                    <span>
                      {withdrawal.parentesco_declarado_nombre}
                      {withdrawal.parentesco_declarado_detalle
                        ? ` · ${withdrawal.parentesco_declarado_detalle}`
                        : ""}
                    </span>
                    <strong>{withdrawal.motivo_nombre}</strong>
                    {withdrawal.motivo_detalle && (
                      <p>{withdrawal.motivo_detalle}</p>
                    )}
                  </div>
                  <div
                    className={`authorization-match ${withdrawal.coincidencia_autorizada ? "authorization-match--yes" : "authorization-match--no"}`}
                  >
                    {withdrawal.coincidencia_autorizada ? (
                      <BadgeCheck size={18} />
                    ) : (
                      <ShieldAlert size={18} />
                    )}
                    <span>
                      {withdrawal.coincidencia_autorizada
                        ? `Autorización vigente: ${withdrawal.autorizacion.parentesco}`
                        : "Sin autorización previa vigente"}
                    </span>
                  </div>
                  <div className="withdrawal-record__actions">
                    {withdrawal.estado === "SOLICITADO" &&
                      canApproveWithdrawal && (
                        <>
                          <button
                            type="button"
                            className="secondary-action secondary-action--danger"
                            onClick={() =>
                              openAction({
                                type: "reject-withdrawal",
                                id: withdrawal.id,
                                kicker: "Decisión responsable",
                                title: "Rechazar retiro",
                                description:
                                  "La solicitud quedará rechazada con el motivo y responsable registrados.",
                                fieldLabel: "Motivo del rechazo",
                                minimum: 8,
                                confirmLabel: "Rechazar solicitud",
                                danger: true,
                              })
                            }
                          >
                            <XCircle size={17} /> Rechazar
                          </button>
                          {withdrawal.coincidencia_autorizada ? (
                            <button
                              type="button"
                              className="primary-action"
                              onClick={() =>
                                openAction({
                                  type: "approve-withdrawal",
                                  id: withdrawal.id,
                                  kicker: "Decisión responsable",
                                  title: "Autorizar retiro",
                                  description: `Existe autorización vigente para ${withdrawal.visitante.nombre_completo}. Puedes añadir una observación breve.`,
                                  fieldLabel: "Observación de la decisión",
                                  minimum: 0,
                                  confirmLabel: "Autorizar retiro",
                                })
                              }
                            >
                              <ShieldCheck size={17} /> Autorizar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="primary-action primary-action--warning"
                              onClick={() =>
                                openAction({
                                  type: "approve-withdrawal",
                                  id: withdrawal.id,
                                  kicker: "Excepción institucional",
                                  title: "Autorizar retiro excepcional",
                                  description:
                                    "No existe autorización previa vigente. Explica por qué se autoriza esta excepción.",
                                  fieldLabel:
                                    "Fundamento de la autorización excepcional",
                                  minimum: 10,
                                  confirmLabel: "Autorizar excepción",
                                })
                              }
                            >
                              <ShieldAlert size={17} /> Revisar excepción
                            </button>
                          )}
                        </>
                      )}
                    {withdrawal.estado === "AUTORIZADO" &&
                      canApproveWithdrawal && (
                        <button
                          type="button"
                          className="primary-action"
                          onClick={() => deliverStudent(withdrawal)}
                        >
                          <UserCheck size={17} /> Confirmar entrega
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
            {canManageAuthorizations && (
              <div className="visit-authorization-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>Administrar autorizaciones oficiales</strong>
                  <span>
                    Consulta o registra una persona autorizada antes de resolver
                    una solicitud.
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setTab("autorizaciones")}
                >
                  Abrir autorizaciones
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      <ActionDialog
        action={action}
        value={actionReason}
        onChange={setActionReason}
        onCancel={() => {
          if (!savingAction) setAction(null);
        }}
        onConfirm={executeAction}
        saving={savingAction}
      />
    </div>
  );
}
