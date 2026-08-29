import { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, FileCheck2, Fingerprint, Upload, X } from 'lucide-react';
import { API_URL } from '../config';
import AppSelect from './AppSelect';
import { formatRutInput, validateRutInput } from '../utils/personFormat';
import { getApiErrorMessage } from '../utils/apiError';

const supportOptions = [
  { value: 'CEDULA_IDENTIDAD', label: 'Cédula de identidad' },
  { value: 'CERTIFICADO_NACIMIENTO', label: 'Certificado de nacimiento' },
  { value: 'COMPROBANTE_REGULARIZACION', label: 'Comprobante de regularización' },
  { value: 'DOCUMENTO_MINEDUC', label: 'Documento Mineduc' },
  { value: 'OTRO', label: 'Otro respaldo institucional' }
];

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('No fue posible leer el archivo.'));
  reader.readAsDataURL(file);
});

const StudentIdentityRegularizationModal = ({ state, onClose, onSaved }) => {
  const [run, setRun] = useState('');
  const [reason, setReason] = useState('');
  const [supportType, setSupportType] = useState('');
  const [supportDetail, setSupportDetail] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return undefined;
    setRun('');
    setReason('');
    setSupportType('');
    setSupportDetail('');
    setFile(null);
    setError('');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [state, onClose]);

  if (!state) return null;

  const student = state.alumno;
  const currentIpe = state.identificadores?.find(
    (identifier) => identifier.tipo === 'IPE_MINEDUC' && identifier.es_principal
  )?.valor_original || student?.documento_erp || 'IPE no disponible';

  const submit = async (event) => {
    event.preventDefault();
    if (!validateRutInput(run)) return setError('El nuevo RUN chileno no es válido.');
    if (reason.trim().length < 10) return setError('Explique la regularización en al menos 10 caracteres.');
    if (!supportType) return setError('Seleccione el tipo de respaldo institucional.');
    if (supportType === 'OTRO' && supportDetail.trim().length < 5) {
      return setError('Describa el respaldo utilizado.');
    }
    if (!file) return setError('Adjunte el documento que respalda la regularización.');
    if (file.size > 8 * 1024 * 1024) return setError('El respaldo supera el máximo de 8 MB.');

    setSaving(true);
    setError('');
    try {
      const fileData = await readFileAsDataUrl(file);
      const response = await axios.post(
        `${API_URL}/students/${student.id_alumno}/identifiers/ipe-to-run`,
        {
          run,
          motivo: reason,
          tipo_respaldo: supportType,
          detalle_respaldo: supportDetail,
          fileName: file.name,
          fileData
        },
        { withCredentials: true }
      );
      await onSaved(response.data.message);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'No fue posible regularizar la identidad.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="student-manual-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="student-manual-modal identity-regularization-modal" role="dialog" aria-modal="true" aria-labelledby="identity-regularization-title">
        <header className="student-manual-header">
          <span className="student-manual-icon"><Fingerprint size={22} /></span>
          <div>
            <span>REGULARIZACIÓN DE IDENTIDAD</span>
            <h2 id="identity-regularization-title">Vincular nuevo RUN</h2>
            <p>El estudiante conservará su IPE y todo su historial; el RUN pasará a ser su identificador principal.</p>
          </div>
          <button type="button" className="student-manual-close" onClick={onClose} aria-label="Cerrar regularización"><X size={20} /></button>
        </header>

        <form onSubmit={submit}>
          <div className="identity-transition">
            <article><span>Identificador actual</span><strong>IPE {currentIpe}</strong><small>Se conservará como identificador anterior</small></article>
            <span className="identity-transition__arrow">→</span>
            <article><span>Nuevo identificador principal</span><strong>{run || 'RUN por ingresar'}</strong><small>La ficha y sus relaciones no cambiarán</small></article>
          </div>

          <div className="student-manual-grid">
            <label className="student-manual-field">
              <span>Nuevo RUN chileno</span>
              <input
                value={run}
                onChange={(event) => setRun(formatRutInput(event.target.value))}
                placeholder="12.345.678-5"
                inputMode="text"
                autoComplete="off"
              />
              <small>Se validará el dígito verificador y que no pertenezca a otra ficha.</small>
            </label>
            <label className="student-manual-field">
              <span>Tipo de respaldo</span>
              <AppSelect
                ariaLabel="Tipo de respaldo de la regularización"
                value={supportType}
                onChange={setSupportType}
                options={[{ value: '', label: 'Seleccionar respaldo' }, ...supportOptions]}
              />
            </label>
            <label className="student-manual-field student-manual-field--wide">
              <span>Motivo institucional</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value.slice(0, 500))}
                placeholder="Explique por qué se reemplaza el IPE como identificador principal."
              />
            </label>
            <label className="student-manual-field">
              <span>Detalle del respaldo <em>{supportType === 'OTRO' ? 'obligatorio' : 'opcional'}</em></span>
              <input
                value={supportDetail}
                onChange={(event) => setSupportDetail(event.target.value.slice(0, 500))}
                placeholder="Folio, fecha o antecedente revisado"
              />
            </label>
            <label className="student-manual-field identity-support-upload">
              <span>Documento de respaldo</span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              <span className="identity-support-upload__button"><Upload size={17} /> {file ? file.name : 'Seleccionar PDF, PNG o JPG'}</span>
              <small>Máximo 8 MB. El archivo quedará protegido y asociado a esta operación.</small>
            </label>
          </div>

          <aside className="identity-regularization-warning">
            <AlertTriangle size={20} />
            <div><strong>Esta acción no crea otro estudiante</strong><span>Atrasos, matrícula, apoderados, documentos y justificaciones seguirán vinculados a la misma ficha.</span></div>
          </aside>

          {error && <div className="student-manual-error" role="alert"><AlertTriangle size={18} /> {error}</div>}

          <footer className="student-manual-footer">
            <div><FileCheck2 size={17} /> La operación y su respaldo quedarán registrados en auditoría.</div>
            <button type="button" className="student-manual-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className="student-manual-primary" disabled={saving}>
              <CheckCircle2 size={17} /> {saving ? 'Regularizando…' : 'Confirmar vínculo'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

export default StudentIdentityRegularizationModal;
