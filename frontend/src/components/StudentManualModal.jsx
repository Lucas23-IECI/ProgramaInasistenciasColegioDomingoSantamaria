import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Archive, CheckCircle2, RotateCcw, Save, ScanLine, UserPlus, X } from 'lucide-react';
import { API_URL } from '../config';
import AppSelect from './AppSelect';
import PassportMrzPanel from './PassportMrzPanel';
import { formatChilePhoneInput } from '../utils/personFormat';
import { getApiErrorMessage } from '../utils/apiError';
import {
  MANUAL_IDENTITY_TYPES,
  countryOptions,
  formatManualIdentityDocument,
  getManualIdentityLabel,
  isForeignManualIdentity,
  manualIdentityOptions,
  resolveManualIdentityCountry,
  validateManualIdentityForm,
} from '../utils/studentIdentity';

const emptyForm = {
  tipo_identificador: MANUAL_IDENTITY_TYPES.RUN_CHILE,
  documento: '',
  pais_emisor: '',
  pais_emisor_otro: '',
  nombres: '',
  paterno: '',
  materno: '',
  grade: '',
  email: '',
  telefono: '',
  motivo_alta_manual: '',
  detalle_alta_manual: '',
  motivo: ''
};

const manualReasonOptions = [
  { value: 'MATRICULA_RECIENTE', label: 'Matrícula reciente' },
  { value: 'TRASLADO_ESTABLECIMIENTO', label: 'Traslado desde otro establecimiento' },
  { value: 'PENDIENTE_ERP', label: 'Ingreso pendiente en ERP' },
  { value: 'ERROR_TEMPORAL_ERP', label: 'Error temporal del ERP' },
  { value: 'REGULARIZACION_INSTITUCIONAL', label: 'Regularización institucional' },
  { value: 'OTRO', label: 'Otro motivo' }
];

const getStudent = (details) => details?.alumno || details || null;

const StudentManualModal = ({ state, courses, canReadPassportMrz = false, onClose, onSaved }) => {
  const student = getStudent(state?.student);
  const mode = state?.mode || 'create';
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [mrzOpen, setMrzOpen] = useState(false);

  useEffect(() => {
    if (!state) return undefined;
    const primaryIdentifier = state?.student?.identificadores?.find(
      (identifier) => identifier.es_principal
    );
    const legacyType = student?.tipo_identificador === 'DOCUMENTO_EXTRANJERO'
      ? student?.tipo_documento_extranjero
      : student?.tipo_identificador;
    const storedIdentityType = primaryIdentifier?.tipo
      || legacyType
      || MANUAL_IDENTITY_TYPES.RUN_CHILE;
    const identityType = ['CODIGO_INTERNO', 'SIN_IDENTIFICADOR_MANUAL'].includes(storedIdentityType)
      ? MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
      : storedIdentityType;
    const identityDocument = primaryIdentifier?.valor_original
      || (student?.rut ? `${student.rut}-${student.dv || ''}` : student?.documento_erp)
      || '';
    setError('');
    setForm({
      ...emptyForm,
      tipo_identificador: identityType,
      documento: formatManualIdentityDocument(identityType, identityDocument),
      pais_emisor: primaryIdentifier?.pais_emisor || student?.pais_emisor_documento || '',
      pais_emisor_otro: '',
      nombres: student?.nombres || '',
      paterno: student?.paterno || '',
      materno: student?.materno || '',
      grade: student?.grade || '',
      email: student?.email || '',
      telefono: formatChilePhoneInput(student?.telefono || ''),
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [state, student, onClose]);

  const title = {
    create: 'Agregar estudiante manualmente',
    edit: 'Editar ficha del estudiante',
    retire: 'Retirar matrícula',
    reactivate: 'Reactivar matrícula'
  }[mode];
  const courseOptions = useMemo(
    () => courses.map((course) => ({ value: course.nombre_curso, label: course.nombre_curso })),
    [courses]
  );

  if (!state) return null;

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const applyMrz = (parsed) => {
    const countryIsKnown = countryOptions.some((option) => option.value === parsed.pais_emisor);
    const [firstSurname = '', ...otherSurnames] = parsed.apellidos.split(' ').filter(Boolean);
    setForm((current) => ({
      ...current,
      documento: parsed.numero_pasaporte,
      pais_emisor: countryIsKnown ? parsed.pais_emisor : 'OTRO',
      pais_emisor_otro: countryIsKnown ? '' : parsed.pais_emisor,
      nombres: current.nombres || parsed.nombres,
      paterno: current.paterno || firstSurname,
      materno: current.materno || otherSurnames.join(' '),
    }));
    setMrzOpen(false);
  };

  const validate = () => {
    if (mode === 'retire') {
      if (form.motivo.trim().length < 5) return 'Explique brevemente por qué se retira la matrícula.';
      return '';
    }
    if (mode === 'reactivate') return form.grade ? '' : 'Seleccione el curso vigente.';
    if (mode === 'create') {
      const identityError = validateManualIdentityForm(form);
      if (identityError) return identityError;
    }
    if (mode === 'create' && !form.motivo_alta_manual) return 'Seleccione el motivo del alta manual.';
    if (
      mode === 'create'
      && form.tipo_identificador === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
      && form.detalle_alta_manual.trim().length < 10
    ) {
      return 'Explique por qué el estudiante no dispone de documento.';
    }
    if (mode === 'create' && form.motivo_alta_manual === 'OTRO' && form.detalle_alta_manual.trim().length < 5) {
      return 'Explique el motivo del alta manual.';
    }
    if (form.nombres.trim().length < 2) return 'Ingrese los nombres del estudiante.';
    if (form.paterno.trim().length < 2) return 'Ingrese el apellido paterno.';
    if (!form.grade) return 'Seleccione un curso institucional.';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Revise el correo electrónico.';
    return '';
  };

  const submit = async (event) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        tipo_identificador: form.tipo_identificador,
        documento: form.documento,
        pais_emisor: resolveManualIdentityCountry(form),
        rut: form.tipo_identificador === MANUAL_IDENTITY_TYPES.RUN_CHILE ? form.documento : '',
        nombres: form.nombres,
        paterno: form.paterno,
        materno: form.materno,
        grade: form.grade,
        email: form.email,
        telefono: form.telefono,
        motivo_alta_manual: form.motivo_alta_manual,
        detalle_alta_manual: form.detalle_alta_manual
      };
      let response;
      if (mode === 'create') {
        response = await axios.post(`${API_URL}/students`, payload, { withCredentials: true });
      } else if (mode === 'edit') {
        response = await axios.put(`${API_URL}/students/${student.id_alumno}`, payload, { withCredentials: true });
      } else if (mode === 'retire') {
        response = await axios.delete(`${API_URL}/students/${student.id_alumno}`, {
          data: { motivo: form.motivo },
          withCredentials: true
        });
      } else {
        response = await axios.post(
          `${API_URL}/students/${student.id_alumno}/reactivate`,
          { grade: form.grade },
          { withCredentials: true }
        );
      }
      onSaved(response.data?.message || 'Cambio guardado correctamente.');
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible guardar el cambio.'));
    } finally {
      setSaving(false);
    }
  };

  const isRetire = mode === 'retire';
  const isReactivate = mode === 'reactivate';

  return (
    <div className="student-manual-overlay" onMouseDown={onClose}>
      <section
        className="student-manual-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-manual-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="student-manual-header">
          <div className={`student-manual-icon student-manual-icon--${mode}`}>
            {mode === 'create' && <UserPlus />}
            {mode === 'edit' && <Save />}
            {isRetire && <Archive />}
            {isReactivate && <RotateCcw />}
          </div>
          <div>
            <span>GESTIÓN CONTROLADA DE MATRÍCULA</span>
            <h2 id="student-manual-title">{title}</h2>
            <p>
              {isRetire
                ? 'El estudiante dejará de figurar como vigente, pero su ficha y su historial se conservarán.'
                : isReactivate
                  ? 'Seleccione el curso al que se reincorpora. La reactivación quedará registrada en auditoría.'
                  : 'Complete la información mínima validada. La creación o edición quedará registrada en auditoría.'}
            </p>
          </div>
          <button type="button" className="student-manual-close" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </header>

        <form onSubmit={submit}>
          {student && (
            <div className="student-manual-subject">
              <strong>{student.nombres} {student.paterno} {student.materno || ''}</strong>
              <span>
                {getManualIdentityLabel(form.tipo_identificador)} {form.documento || 'pendiente'}
                {' · '}
                {student.grade || 'Sin curso'}
              </span>
            </div>
          )}

          {isRetire ? (
            <label className="student-manual-field student-manual-field--wide">
              <span>Motivo del retiro</span>
              <textarea
                value={form.motivo}
                onChange={(event) => update('motivo', event.target.value)}
                placeholder="Ej.: traslado de establecimiento informado por Dirección"
                maxLength={240}
                autoFocus
              />
              <small>Este antecedente se conserva en la auditoría institucional.</small>
            </label>
          ) : isReactivate ? (
            <label className="student-manual-field student-manual-field--wide">
              <span>Curso vigente</span>
              <AppSelect
                value={form.grade}
                onChange={(value) => update('grade', value)}
                options={courseOptions}
                placeholder="Seleccionar curso"
                ariaLabel="Curso para reactivar matrícula"
              />
            </label>
          ) : (
            <div className="student-manual-grid">
              <label className="student-manual-field">
                <span>Tipo de identificación</span>
                <AppSelect
                  value={form.tipo_identificador}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    tipo_identificador: value,
                    documento: '',
                    pais_emisor: '',
                    pais_emisor_otro: '',
                  }))}
                  options={manualIdentityOptions}
                  ariaLabel="Tipo de identificación del estudiante"
                  disabled={mode === 'edit'}
                />
                <small>
                  {mode === 'edit'
                    ? 'La identidad principal se modifica solamente mediante un flujo de regularización.'
                    : 'Seleccione el documento realmente disponible; no se validan documentos extranjeros como RUN.'}
                </small>
              </label>
              <label className="student-manual-field">
                <span>Curso</span>
                <AppSelect
                  value={form.grade}
                  onChange={(value) => update('grade', value)}
                  options={courseOptions}
                  placeholder="Seleccionar curso"
                  ariaLabel="Curso del estudiante"
                />
              </label>
              {form.tipo_identificador !== MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO && (
                <label className="student-manual-field">
                  <span>{getManualIdentityLabel(form.tipo_identificador)}</span>
                  <input
                    value={form.documento}
                    onChange={(event) => update(
                      'documento',
                      formatManualIdentityDocument(form.tipo_identificador, event.target.value)
                    )}
                    placeholder={
                      form.tipo_identificador === MANUAL_IDENTITY_TYPES.RUN_CHILE
                        ? '12.345.678-5'
                        : form.tipo_identificador === MANUAL_IDENTITY_TYPES.IPE_MINEDUC
                          ? '100.123.456-7'
                          : 'Número completo'
                    }
                    inputMode={form.tipo_identificador === MANUAL_IDENTITY_TYPES.RUN_CHILE ? 'text' : 'text'}
                    disabled={mode === 'edit'}
                    autoFocus={mode === 'create'}
                  />
                  <small>
                    {form.tipo_identificador === MANUAL_IDENTITY_TYPES.RUN_CHILE
                      ? 'Se verifica el dígito verificador chileno.'
                      : form.tipo_identificador === MANUAL_IDENTITY_TYPES.IPE_MINEDUC
                        ? 'Se conserva como identidad provisoria hasta su regularización.'
                        : 'Se comprueba estructura, país y duplicidad; no autenticidad física.'}
                  </small>
                  {mode === 'create' && canReadPassportMrz && form.tipo_identificador === MANUAL_IDENTITY_TYPES.PASAPORTE && (
                    <button type="button" className="student-mrz-open" onClick={() => setMrzOpen(true)}>
                      <ScanLine size={17} /> Leer zona MRZ
                    </button>
                  )}
                </label>
              )}
              {isForeignManualIdentity(form.tipo_identificador) && (
                <label className="student-manual-field">
                  <span>País emisor</span>
                  <AppSelect
                    value={form.pais_emisor}
                    onChange={(value) => update('pais_emisor', value)}
                    options={countryOptions}
                    placeholder="Seleccionar país"
                    ariaLabel="País emisor del documento"
                    disabled={mode === 'edit'}
                  />
                  <small>El país forma parte de la identidad y evita coincidencias incorrectas.</small>
                </label>
              )}
              {isForeignManualIdentity(form.tipo_identificador) && form.pais_emisor === 'OTRO' && (
                <label className="student-manual-field">
                  <span>Código del país emisor</span>
                  <input
                    value={form.pais_emisor_otro}
                    onChange={(event) => update(
                      'pais_emisor_otro',
                      event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
                    )}
                    placeholder="Ej.: DEU"
                    autoComplete="off"
                    disabled={mode === 'edit'}
                  />
                  <small>Use el código ISO 3166-1 alfa-3 indicado por el documento.</small>
                </label>
              )}
              {form.tipo_identificador === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO && (
                <div className="student-manual-identity-note student-manual-field--wide">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Se creará una identidad interna provisoria</strong>
                    <span>
                      El estudiante podrá utilizar un código institucional, pero la ficha quedará pendiente de regularización.
                    </span>
                  </div>
                </div>
              )}
              <label className="student-manual-field">
                <span>Nombres</span>
                <input value={form.nombres} onChange={(event) => update('nombres', event.target.value)} maxLength={120} />
              </label>
              <label className="student-manual-field">
                <span>Apellido paterno</span>
                <input value={form.paterno} onChange={(event) => update('paterno', event.target.value)} maxLength={80} />
              </label>
              <label className="student-manual-field">
                <span>Apellido materno <em>opcional</em></span>
                <input value={form.materno} onChange={(event) => update('materno', event.target.value)} maxLength={80} />
              </label>
              <label className="student-manual-field">
                <span>Teléfono <em>opcional</em></span>
                <input
                  value={form.telefono}
                  onChange={(event) => update('telefono', formatChilePhoneInput(event.target.value))}
                  inputMode="tel"
                  placeholder="+56 9 1234 5678"
                />
              </label>
              <label className="student-manual-field student-manual-field--wide">
                <span>Correo de contacto <em>opcional</em></span>
                <input
                  value={form.email}
                  onChange={(event) => update('email', event.target.value)}
                  type="email"
                  maxLength={160}
                  placeholder="familia@correo.cl"
                />
              </label>
              {mode === 'create' && (
                <>
                  <label className="student-manual-field student-manual-field--wide">
                    <span>Motivo del alta manual</span>
                    <AppSelect
                      value={form.motivo_alta_manual}
                      onChange={(value) => update('motivo_alta_manual', value)}
                      options={manualReasonOptions}
                      placeholder="Seleccionar motivo institucional"
                      ariaLabel="Motivo del alta manual"
                    />
                    <small>Permite distinguir una matrícula reciente de una regularización o espera del ERP.</small>
                  </label>
                  {(
                    form.motivo_alta_manual === 'OTRO'
                    || form.tipo_identificador === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
                    || form.detalle_alta_manual
                  ) && (
                    <label className="student-manual-field student-manual-field--wide">
                      <span>
                        Detalle del alta {
                          form.motivo_alta_manual === 'OTRO'
                          || form.tipo_identificador === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
                            ? ''
                            : <em>opcional</em>
                        }
                      </span>
                      <textarea
                        value={form.detalle_alta_manual}
                        onChange={(event) => update('detalle_alta_manual', event.target.value)}
                        maxLength={500}
                        placeholder="Antecedente breve que ayude a validar esta ficha"
                      />
                    </label>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="student-manual-error" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

          <footer className="student-manual-footer">
            <div>
              <CheckCircle2 size={18} />
              <span>No se crean cursos nuevos ni se elimina historial automáticamente.</span>
            </div>
            <button type="button" className="student-manual-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className={`student-manual-primary student-manual-primary--${mode}`} disabled={saving}>
              {saving ? 'Guardando…' : title}
            </button>
          </footer>
        </form>
      </section>
      {mrzOpen && <PassportMrzPanel onApply={applyMrz} onClose={() => setMrzOpen(false)} />}
    </div>
  );
};

export default StudentManualModal;
