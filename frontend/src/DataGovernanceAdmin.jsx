import React, { useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { DatabaseZap, Save, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';

const LABELS = {
  RUT_TELEFONOS: 'RUT y teléfonos',
  AUDITORIA: 'Auditoría',
  DOCUMENTOS: 'Documentos',
  VISITAS_RETIROS: 'Visitas y retiros'
};

const DataGovernanceAdmin = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await axios.get('/api/operaciones/retencion');
      setData(response.data);
      setDrafts(Object.fromEntries(response.data.policies.map((policy) => [policy.categoria, { ...policy }])));
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cargar las políticas.', 'error');
    }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const save = async (policy) => {
    setSaving(policy.categoria);
    try {
      await axios.put(`/api/operaciones/retencion/${policy.categoria}`, {
        dias_retencion: policy.dias_retencion === '' ? null : Number(policy.dias_retencion),
        fundamento: policy.fundamento
      });
      notify('Política documentada. La eliminación automática continúa deshabilitada.', 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar la política.', 'error');
    } finally {
      setSaving('');
    }
  };

  if (!data) return <div className="route-loader">Cargando gobierno de datos…</div>;

  return (
    <div className="students-page">
      <div className="students-card">
        <ModuleHeader
          icon={DatabaseZap}
          title="Gobierno y retención de datos"
          description="Políticas documentadas y previsualización de alcance, sin eliminación automática."
          onBack={() => navigate('/admin')}
          onLogout={async () => { await logout(); navigate('/login'); }}
        />
        <main className="governance-content" data-tour="data-governance">
          <section className="governance-warning">
            <ShieldAlert size={25} />
            <div><strong>Modo seguro: solo previsualización</strong><span>{data.message}</span></div>
          </section>
          <section className="governance-list">
            {Object.values(drafts).map((policy) => (
              <article key={policy.categoria}>
                <header>
                  <span className="section-kicker">{policy.categoria.replaceAll('_', ' ')}</span>
                  <h2>{LABELS[policy.categoria]}</h2>
                  <p>{policy.candidatos === null ? 'Período pendiente de definición' : `${policy.candidatos} registro(s) quedarían fuera del período`}</p>
                </header>
                <label>Días de retención
                  <input
                    type="number"
                    min="30"
                    max="3650"
                    value={policy.dias_retencion ?? ''}
                    placeholder="Pendiente"
                    onChange={(event) => setDrafts((current) => ({ ...current, [policy.categoria]: { ...policy, dias_retencion: event.target.value } }))}
                  />
                </label>
                <label>Fundamento y aprobación institucional
                  <textarea
                    value={policy.fundamento || ''}
                    onChange={(event) => setDrafts((current) => ({ ...current, [policy.categoria]: { ...policy, fundamento: event.target.value } }))}
                    maxLength={1000}
                  />
                </label>
                <button type="button" className="primary-action" onClick={() => save(policy)} disabled={saving === policy.categoria}>
                  <Save size={17} /> {saving === policy.categoria ? 'Guardando…' : 'Documentar política'}
                </button>
              </article>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
};

export default DataGovernanceAdmin;
