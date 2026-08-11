import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Bot, Save, ShieldCheck, X } from 'lucide-react';
import { useFeedback } from '../context/FeedbackContext';

const API = '/api/seguimiento';
const priorities = [['BAJA', 'Baja'], ['MEDIA', 'Media'], ['ALTA', 'Alta'], ['URGENTE', 'Urgente']];
const messageOf = (error, fallback) => error.response?.data?.message || fallback;

const Toggle = ({ checked, onChange, label, description }) => (
  <label className="follow-toggle">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span aria-hidden="true" />
    <div><strong>{label}</strong><small>{description}</small></div>
  </label>
);

const FollowUpAutomationDialog = ({ onClose, onSaved }) => {
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let active = true;
    axios.get(`${API}/configuracion`)
      .then((response) => { if (active) setData(response.data); })
      .catch((error) => notify(messageOf(error, 'No fue posible cargar la configuración.'), 'error'));
    const escape = (event) => { if (event.key === 'Escape' && !savingRef.current) onClose(); };
    document.addEventListener('keydown', escape);
    document.body.classList.add('modal-open');
    return () => { active = false; document.removeEventListener('keydown', escape); document.body.classList.remove('modal-open'); };
  }, [notify, onClose]);

  const updateConfiguration = (field, value) => setData((current) => ({
    ...current,
    configuration: { ...current.configuration, [field]: value }
  }));
  const updateRule = (code, field, value) => setData((current) => ({
    ...current,
    rules: current.rules.map((rule) => rule.codigo === code ? { ...rule, [field]: value } : rule)
  }));
  const toggleEscalationGroup = (ruleCode, groupCode, checked) => setData((current) => ({
    ...current,
    rules: current.rules.map((rule) => rule.codigo !== ruleCode ? rule : {
      ...rule,
      escalamiento_grupos: checked
        ? [...new Set([...(rule.escalamiento_grupos || []), groupCode])]
        : (rule.escalamiento_grupos || []).filter((code) => code !== groupCode)
    })
  }));

  const save = async () => {
    savingRef.current = true; setSaving(true);
    try {
      await axios.patch(`${API}/configuracion`, data.configuration);
      await Promise.all(data.rules.map((rule) => axios.patch(`${API}/reglas/${rule.codigo}`, {
        umbral: Number(rule.umbral),
        ventana_dias: rule.ventana_dias === null || rule.ventana_dias === '' ? null : Number(rule.ventana_dias),
        prioridad: rule.prioridad,
        plazo_dias: Number(rule.plazo_dias),
        activa: Boolean(rule.activa),
        responsable_perfil_codigo: rule.responsable_perfil_codigo || null,
        escalamiento_dias: rule.escalamiento_dias === null || rule.escalamiento_dias === '' ? null : Number(rule.escalamiento_dias),
        escalamiento_grupos: rule.escalamiento_grupos || [],
        notificar_responsable: Boolean(rule.notificar_responsable)
      })));
      notify('Configuración de seguimiento guardada.', 'success');
      onSaved?.();
      onClose();
    } catch (error) {
      notify(messageOf(error, 'No fue posible guardar la configuración.'), 'error');
    } finally { savingRef.current = false; setSaving(false); }
  };

  return <div className="follow-dialog-backdrop" onMouseDown={() => !saving && onClose()}>
    <section className="follow-dialog follow-automation" role="dialog" aria-modal="true" aria-labelledby="follow-automation-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span className="section-kicker">Control institucional</span><h2 id="follow-automation-title">Reglas y automatización</h2><p>Define cuándo se revisa la información, quién recibe cada caso y cómo escala un vencimiento.</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar configuración"><X /></button>
      </header>
      {!data ? <div className="follow-state"><Bot size={28} /><p>Cargando reglas institucionales…</p></div> : <>
        <section className="follow-automation__policy">
          <div className="follow-automation__intro"><ShieldCheck /><div><strong>Activación controlada</strong><p>Las reglas se pueden revisar manualmente en cualquier momento. La ejecución periódica solo opera al activar este control.</p></div></div>
          <div className="follow-automation__switches">
            <Toggle checked={data.configuration.automatizacion_activa} onChange={(value) => updateConfiguration('automatizacion_activa', value)} label="Revisión automática" description="Evalúa las reglas con la frecuencia indicada." />
            <Toggle checked={data.configuration.asignacion_automatica} onChange={(value) => updateConfiguration('asignacion_automatica', value)} label="Asignación automática" description="Distribuye cada caso al perfil responsable con menor carga." />
            <Toggle checked={data.configuration.escalamiento_automatico} onChange={(value) => updateConfiguration('escalamiento_automatico', value)} label="Escalamiento por plazo" description="Eleva prioridad cuando se supera el margen definido." />
            <Toggle checked={data.configuration.notificaciones_activas} onChange={(value) => updateConfiguration('notificaciones_activas', value)} label="Avisar responsables" description="Crea avisos internos por asignación y vencimiento." />
          </div>
          <label className="follow-automation__interval">Frecuencia de revisión<input type="number" min="5" max="1440" value={data.configuration.intervalo_minutos} onChange={(event) => updateConfiguration('intervalo_minutos', event.target.value)} /><span>minutos</span></label>
          {data.configuration.ultima_ejecucion_en && <p className="follow-automation__last">Última revisión: {new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.configuration.ultima_ejecucion_en))}</p>}
        </section>
        <section className="follow-automation__rules" aria-label="Reglas automáticas">
          {data.rules.map((rule) => <article key={rule.codigo} className={rule.activa ? '' : 'is-disabled'}>
            <header><div><span>{rule.tipo_senal.replaceAll('_', ' ')}</span><h3>{rule.nombre}</h3><p>{rule.descripcion}</p></div><Toggle checked={rule.activa} onChange={(value) => updateRule(rule.codigo, 'activa', value)} label={rule.activa ? 'Activa' : 'Inactiva'} description="" /></header>
            <div className="follow-automation__rule-grid">
              <label>Umbral<input type="number" min="1" value={rule.umbral} onChange={(event) => updateRule(rule.codigo, 'umbral', event.target.value)} /></label>
              <label>Ventana (días)<input type="number" min="1" placeholder="No aplica" value={rule.ventana_dias ?? ''} onChange={(event) => updateRule(rule.codigo, 'ventana_dias', event.target.value)} /></label>
              <label>Prioridad<select value={rule.prioridad} onChange={(event) => updateRule(rule.codigo, 'prioridad', event.target.value)}>{priorities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Plazo (días)<input type="number" min="1" value={rule.plazo_dias} onChange={(event) => updateRule(rule.codigo, 'plazo_dias', event.target.value)} /></label>
              <label>Perfil responsable<select value={rule.responsable_perfil_codigo || ''} onChange={(event) => updateRule(rule.codigo, 'responsable_perfil_codigo', event.target.value)}><option value="">Asignación manual</option>{data.profiles.map((profile) => <option key={profile.codigo} value={profile.codigo}>{profile.nombre}</option>)}</select></label>
              <label>Margen adicional<input type="number" min="0" placeholder="Sin escalamiento" value={rule.escalamiento_dias ?? ''} onChange={(event) => updateRule(rule.codigo, 'escalamiento_dias', event.target.value)} /><small>0 escala al vencer</small></label>
            </div>
            <fieldset className="follow-automation__escalation">
              <legend>Equipos avisados al escalar</legend>
              <p>El responsable original conserva el caso; estos equipos reciben supervisión y acceso según sus permisos.</p>
              <div>{(data.escalation_groups || []).map((group) => <label key={group.codigo}>
                <input type="checkbox" checked={(rule.escalamiento_grupos || []).includes(group.codigo)} onChange={(event) => toggleEscalationGroup(rule.codigo, group.codigo, event.target.checked)} />
                <span><strong>{group.nombre}</strong><small>{group.cuentas_activas} cuenta{group.cuentas_activas === 1 ? '' : 's'} activa{group.cuentas_activas === 1 ? '' : 's'}</small></span>
              </label>)}</div>
            </fieldset>
            <Toggle checked={rule.notificar_responsable} onChange={(value) => updateRule(rule.codigo, 'notificar_responsable', value)} label="Notificar a la persona responsable" description="El aviso se genera una sola vez por asignación o escalamiento." />
          </article>)}
        </section>
      </>}
      <footer><button type="button" className="app-action app-action--secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="app-action app-action--primary" onClick={save} disabled={!data || saving}><Save size={17} /> {saving ? 'Guardando…' : 'Guardar configuración'}</button></footer>
    </section>
  </div>;
};

export default FollowUpAutomationDialog;
