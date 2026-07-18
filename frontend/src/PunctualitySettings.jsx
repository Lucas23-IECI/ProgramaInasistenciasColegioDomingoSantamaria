import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BellRing, CheckCircle2, Clock3, Info, Save, Settings2, ShieldAlert } from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import { useFeedback } from './context/FeedbackContext';
import TimeField from './components/TimeField';

const emptyForm = {
  nombre_jornada: 'Jornada principal',
  hora_entrada: '08:00',
  hora_limite_atraso: '08:15',
  minutos_atraso_grave: 15,
  umbral_alerta: 3,
  umbral_critico: 5
};

const clockMinutes = (value) => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

const displayTime = (value) => String(value || '').slice(0, 5);

const PunctualitySettings = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await axios.get(`${API_URL}/puntualidad/config`);
        setForm({
          nombre_jornada: response.data.nombre_jornada,
          hora_entrada: displayTime(response.data.hora_entrada),
          hora_limite_atraso: displayTime(response.data.hora_limite_atraso),
          minutos_atraso_grave: Number(response.data.minutos_atraso_grave),
          umbral_alerta: Number(response.data.umbral_alerta),
          umbral_critico: Number(response.data.umbral_critico)
        });
        setSavedAt(response.data.actualizado_en || null);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible cargar la jornada.', 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [notify]);

  const validation = useMemo(() => {
    const entry = clockMinutes(form.hora_entrada);
    const threshold = clockMinutes(form.hora_limite_atraso);
    if (form.nombre_jornada.trim().length < 3) return 'Escribe un nombre de jornada reconocible.';
    if (entry === null || threshold === null || threshold <= entry) return 'La hora límite debe ser posterior a la hora de entrada.';
    if (Number(form.minutos_atraso_grave) < 1 || Number(form.minutos_atraso_grave) > 180) return 'El atraso grave debe comenzar entre 1 y 180 minutos después del límite.';
    if (Number(form.umbral_alerta) < 1 || Number(form.umbral_critico) <= Number(form.umbral_alerta)) return 'La alerta crítica debe ser mayor que la preventiva.';
    return '';
  }, [form]);

  const severeTime = useMemo(() => {
    const threshold = clockMinutes(form.hora_limite_atraso);
    if (threshold === null) return '—';
    const total = threshold + Number(form.minutos_atraso_grave || 0);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }, [form.hora_limite_atraso, form.minutos_atraso_grave]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleSave = async (event) => {
    event.preventDefault();
    if (validation) return notify(validation, 'error');
    setSaving(true);
    try {
      const response = await axios.put(`${API_URL}/puntualidad/config`, {
        ...form,
        minutos_atraso_grave: Number(form.minutos_atraso_grave),
        umbral_alerta: Number(form.umbral_alerta),
        umbral_critico: Number(form.umbral_critico)
      });
      setSavedAt(response.data.config.actualizado_en);
      notify('Jornada actualizada y registrada en auditoría.', 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar la configuración.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <div className="app-container settings-page">
      <div className="settings-surface">
        <ModuleHeader icon={Settings2} title="Configuración de puntualidad" description="Reglas institucionales de clasificación y alertas preventivas." onBack={() => navigate('/admin')} onLogout={handleLogout} />

        {loading ? <div className="settings-loading">Cargando reglas institucionales…</div> : (
          <form className="settings-layout" onSubmit={handleSave} data-tour="punctuality-settings">
            <main className="settings-form-area">
              <section className="settings-section">
                <div className="settings-section__heading"><span>01</span><div><h2>Identificación de la jornada</h2><p>El nombre aparecerá en el lector y en el panel operativo.</p></div></div>
                <label className="settings-field settings-field--wide"><span>Nombre de la jornada</span><input type="text" maxLength="80" value={form.nombre_jornada} onChange={(event) => update('nombre_jornada', event.target.value)} /><small>Ejemplo: Jornada principal, ingreso enseñanza media.</small></label>
              </section>

              <section className="settings-section">
                <div className="settings-section__heading"><span>02</span><div><h2>Reglas horarias</h2><p>Estas horas clasifican cada ingreso en el momento exacto del registro.</p></div></div>
                <div className="settings-grid">
                  <div className="settings-field"><span>Hora oficial de entrada</span><TimeField ariaLabel="Hora oficial de entrada" value={form.hora_entrada} onChange={(value) => update('hora_entrada', value)} /><small>Referencia comunicada a la comunidad.</small></div>
                  <div className="settings-field"><span>Inicio del atraso</span><TimeField ariaLabel="Inicio del atraso" value={form.hora_limite_atraso} onChange={(value) => update('hora_limite_atraso', value)} /><small>Desde esta hora el ingreso cuenta como atraso.</small></div>
                  <label className="settings-field"><span>Minutos hasta atraso grave</span><div className="number-field"><input type="number" min="1" max="180" value={form.minutos_atraso_grave} onChange={(event) => update('minutos_atraso_grave', event.target.value)} /><span>min</span></div><small>Después del límite de atraso.</small></label>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section__heading"><span>03</span><div><h2>Seguimiento preventivo</h2><p>Define cuántos atrasos registrados activan la revisión en los últimos 30 días.</p></div></div>
                <div className="settings-grid settings-grid--two">
                  <label className="settings-field"><span>Alerta preventiva</span><div className="number-field"><input type="number" min="1" max="50" value={form.umbral_alerta} onChange={(event) => update('umbral_alerta', event.target.value)} /><span>atrasos</span></div></label>
                  <label className="settings-field"><span>Alerta crítica</span><div className="number-field"><input type="number" min="2" max="100" value={form.umbral_critico} onChange={(event) => update('umbral_critico', event.target.value)} /><span>atrasos</span></div></label>
                </div>
              </section>

              {validation && <div className="settings-validation" role="alert"><AlertTriangle size={19} /><span>{validation}</span></div>}
              <div className="settings-submit-row"><div><strong>Cambios auditables</strong><span>{savedAt ? `Última actualización: ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(savedAt))}` : 'Sin actualización previa'}</span></div><button type="submit" disabled={saving || Boolean(validation)}><Save size={19} /> {saving ? 'Guardando…' : 'Guardar configuración'}</button></div>
            </main>

            <aside className="settings-preview" aria-label="Vista previa de reglas">
              <span className="section-kicker">Vista previa</span><h2>Cómo se clasificará un ingreso</h2>
              <div className="rule-timeline">
                <article data-tone="neutral"><i><Clock3 size={18} /></i><div><strong>Hasta {form.hora_limite_atraso || '—'}</strong><span>Ingreso a tiempo</span></div></article>
                <article data-tone="warning"><i><AlertTriangle size={18} /></i><div><strong>Desde {form.hora_limite_atraso || '—'} hasta {severeTime}</strong><span>Atraso leve</span></div></article>
                <article data-tone="danger"><i><ShieldAlert size={18} /></i><div><strong>Después de {severeTime}</strong><span>Atraso grave</span></div></article>
              </div>
              <div className="settings-preview__alerts"><h3><BellRing size={18} /> Alertas de recurrencia</h3><p><strong>{form.umbral_alerta}</strong> atrasos generan seguimiento preventivo.</p><p><strong>{form.umbral_critico}</strong> atrasos generan seguimiento crítico.</p></div>
              <div className="settings-preview__notice"><Info size={18} /><span>Las reglas se aplican a registros nuevos. Las correcciones históricas se recalculan con la configuración vigente y conservan sus valores anteriores en el historial.</span></div>
              <div className="settings-preview__status"><CheckCircle2 size={18} /><span>Zona horaria institucional: America/Santiago</span></div>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
};

export default PunctualitySettings;
