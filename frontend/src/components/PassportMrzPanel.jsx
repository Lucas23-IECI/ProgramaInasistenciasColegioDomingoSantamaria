import { useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, CheckCircle2, ScanLine, ShieldCheck, X } from 'lucide-react';
import { API_URL } from '../config';
import { normalizeMrzInput, parsePassportTd3Mrz } from '../utils/passportMrz';

const PassportMrzPanel = ({ onApply, onClose }) => {
  const [raw, setRaw] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => (raw ? parsePassportTd3Mrz(raw) : null), [raw]);

  const apply = async () => {
    if (!parsed?.valid || !reviewed) return;
    setError('');
    try {
      await axios.post(`${API_URL}/students/identity/mrz-events`, {
        formato: parsed.formato,
        pais_emisor: parsed.pais_emisor,
        validaciones: parsed.checks,
        revision_fisica: true,
      }, { withCredentials: true });
      onApply(parsed);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No fue posible registrar la lectura MRZ.');
    }
  };

  return (
    <div className="student-mrz-overlay" onMouseDown={onClose}>
      <section className="student-mrz-panel" role="dialog" aria-modal="true" aria-labelledby="student-mrz-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="student-mrz-icon"><ScanLine /></div>
          <div>
            <span>LECTURA LOCAL DE PASAPORTE</span>
            <h3 id="student-mrz-title">Leer zona MRZ</h3>
            <p>Pegue o lea las dos líneas impresas en la parte inferior del pasaporte.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar lectura MRZ"><X /></button>
        </header>

        <label className="student-mrz-input">
          <span>Zona legible por máquina</span>
          <textarea
            value={raw}
            onChange={(event) => setRaw(normalizeMrzInput(event.target.value))}
            placeholder={'P<PAISAPELLIDOS<<NOMBRES<<<<<<<<<<<<<<<<<<<\nNUMEROPAS0PAISAAMMDD0SAAMMDD0<<<<<<<<<<<<00'}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            rows={3}
            maxLength={89}
            autoFocus
          />
          <small>El texto se procesa en este dispositivo. No se cargan ni guardan fotografías.</small>
        </label>

        {parsed && (
          <div className={`student-mrz-result ${parsed.valid ? 'is-valid' : 'is-invalid'}`} role="status">
            {parsed.valid ? <CheckCircle2 /> : <AlertTriangle />}
            <div>
              <strong>{parsed.valid ? 'Dígitos verificadores correctos' : 'Lectura no válida'}</strong>
              <span>{parsed.valid ? `${parsed.numero_pasaporte} · ${parsed.pais_emisor} · ${parsed.nombres} ${parsed.apellidos}` : parsed.error}</span>
            </div>
          </div>
        )}

        <label className="student-mrz-review">
          <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
          <span><ShieldCheck /> Revisé físicamente el pasaporte y la información coincide con el documento presentado.</span>
        </label>
        <p className="student-mrz-warning">Validar los dígitos de la MRZ ayuda a detectar errores de transcripción, pero no demuestra la autenticidad del pasaporte.</p>
        {error && <div className="student-manual-error" role="alert"><AlertTriangle /><span>{error}</span></div>}

        <footer>
          <button type="button" className="student-manual-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="student-manual-primary" onClick={apply} disabled={!parsed?.valid || !reviewed}>Aplicar datos verificados</button>
        </footer>
      </section>
    </div>
  );
};

export default PassportMrzPanel;
