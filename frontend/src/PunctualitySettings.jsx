import React, { useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router';
import {
  AlertTriangle, BellRing, CalendarDays, CheckCircle2, Copy,
  Info, Plus, Save, Settings2, ShieldAlert, Trash2
} from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import { API_URL } from './config';
import ModuleHeader from './components/ModuleHeader';
import { useFeedback } from './context/FeedbackContext';
import TimeField from './components/TimeField';
import AppSelect from './components/AppSelect';

const DAYS = [
  { value: 1, label: 'Lu' }, { value: 2, label: 'Ma' }, { value: 3, label: 'Mi' },
  { value: 4, label: 'Ju' }, { value: 5, label: 'Vi' }, { value: 6, label: 'Sá' },
  { value: 7, label: 'Do' }
];

const CONTROL_TYPES = [
  { value: 'INGRESO', label: 'Ingreso a la jornada' },
  { value: 'REGRESO_RECREO', label: 'Regreso de recreo' },
  { value: 'REGRESO_ALMUERZO', label: 'Regreso de almuerzo' },
  { value: 'TALLER', label: 'Ingreso a taller o actividad' },
  { value: 'OTRO', label: 'Otro control horario' }
];

const displayTime = (value) => String(value || '').slice(0, 5);
const clockMinutes = (value) => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};
const minutesToClock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const controlsShareScope = (left, right) => {
  const sameDay = right.dias_semana.some((day) => left.dias_semana.includes(day));
  const sameStudents = left.cursos_ids.length === 0
    || right.cursos_ids.length === 0
    || right.cursos_ids.some((courseId) => left.cursos_ids.includes(courseId));
  return sameDay && sameStudents;
};

const normalizeControl = (control, index = 0) => ({
  id: control.id ? Number(control.id) : null,
  nombre: control.nombre || 'Nuevo control',
  tipo: control.tipo || 'OTRO',
  hora_apertura: displayTime(control.hora_apertura || '09:30'),
  hora_referencia: displayTime(control.hora_referencia || '09:45'),
  hora_inicio_atraso: displayTime(control.hora_inicio_atraso || '09:50'),
  hora_cierre: displayTime(control.hora_cierre || '10:20'),
  minutos_atraso_grave: Number(control.minutos_atraso_grave || 10),
  dias_semana: (control.dias_semana || [1, 2, 3, 4, 5]).map(Number),
  cursos_ids: (control.cursos_ids || []).map(Number),
  cuenta_alertas: control.cuenta_alertas !== false,
  activo: control.activo !== false,
  orden: Number(control.orden ?? ((index + 1) * 10))
});

const createControl = (lastControl, index) => {
  const previousClose = clockMinutes(lastControl?.hora_cierre) ?? 570;
  const opening = Math.min(previousClose + 15, 1320);
  return normalizeControl({
    nombre: 'Regreso de recreo',
    tipo: 'REGRESO_RECREO',
    hora_apertura: minutesToClock(opening),
    hora_referencia: minutesToClock(opening + 10),
    hora_inicio_atraso: minutesToClock(opening + 15),
    hora_cierre: minutesToClock(opening + 45),
    minutos_atraso_grave: 10,
    orden: (index + 1) * 10
  }, index);
};

const PunctualitySettings = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [general, setGeneral] = useState({
    nombre_jornada: 'Jornada principal',
    umbral_alerta: 3,
    umbral_critico: 5
  });
  const [controls, setControls] = useState([]);
  const [courses, setCourses] = useState([]);
  const [expandedId, setExpandedId] = useState('first');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [configResponse, coursesResponse] = await Promise.all([
          axios.get(`${API_URL}/puntualidad/config`),
          axios.get(`${API_URL}/courses`)
        ]);
        const data = configResponse.data;
        setGeneral({
          nombre_jornada: data.nombre_jornada,
          umbral_alerta: Number(data.umbral_alerta),
          umbral_critico: Number(data.umbral_critico)
        });
        const normalized = (data.controles || []).filter((control) => control.activo).map(normalizeControl);
        setControls(normalized);
        setCourses(coursesResponse.data || []);
        setExpandedId(normalized[0]?.id || 'new-0');
        setSavedAt(data.actualizado_en || null);
      } catch (error) {
        notify(error.response?.data?.message || 'No fue posible cargar los controles horarios.', 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [notify]);

  const validation = useMemo(() => {
    if (general.nombre_jornada.trim().length < 3) return 'Escribe un nombre de jornada reconocible.';
    if (controls.length < 1) return 'La jornada necesita al menos un control horario.';
    if (Number(general.umbral_alerta) < 1 || Number(general.umbral_critico) <= Number(general.umbral_alerta)) {
      return 'La alerta crítica debe ser mayor que la preventiva.';
    }
    for (const control of controls) {
      const opening = clockMinutes(control.hora_apertura);
      const reference = clockMinutes(control.hora_referencia);
      const late = clockMinutes(control.hora_inicio_atraso);
      const closing = clockMinutes(control.hora_cierre);
      if (control.nombre.trim().length < 3) return 'Todos los controles deben tener un nombre claro.';
      if (![opening, reference, late, closing].every(Number.isFinite)
        || !(opening <= reference && reference < late && late < closing)) {
        return `Revisa el orden horario de “${control.nombre}”.`;
      }
      if (late + Number(control.minutos_atraso_grave) >= closing) {
        return `El atraso grave de “${control.nombre}” debe comenzar antes de su cierre.`;
      }
      if (!control.dias_semana.length) return `Selecciona al menos un día para “${control.nombre}”.`;
    }
    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        const left = controls[leftIndex];
        const right = controls[rightIndex];
        if (!controlsShareScope(left, right)) continue;
        const overlaps = clockMinutes(left.hora_apertura) < clockMinutes(right.hora_cierre)
          && clockMinutes(right.hora_apertura) < clockMinutes(left.hora_cierre);
        if (overlaps) {
          return `Los controles “${left.nombre}” y “${right.nombre}” se superponen para los mismos estudiantes.`;
        }
      }
    }
    return '';
  }, [controls, general]);

  const updateControl = (index, patch) => setControls((current) => current.map((control, itemIndex) => (
    itemIndex === index ? { ...control, ...patch } : control
  )));

  const addControl = () => {
    setControls((current) => {
      const next = createControl(current[current.length - 1], current.length);
      setExpandedId(`new-${current.length}`);
      return [...current, next];
    });
  };

  const duplicateControl = (index) => {
    setControls((current) => {
      const source = current[index];
      const clone = { ...source, id: null, nombre: `${source.nombre} (copia)`, orden: (current.length + 1) * 10 };
      return [...current, clone];
    });
  };

  const removeControl = (index) => {
    if (controls.length === 1) return notify('La jornada debe conservar al menos un control.', 'error');
    setControls((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const toggleDay = (index, day) => {
    const current = controls[index].dias_semana;
    updateControl(index, {
      dias_semana: current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort()
    });
  };

  const toggleCourse = (index, courseId) => {
    const current = controls[index].cursos_ids;
    updateControl(index, {
      cursos_ids: current.includes(courseId)
        ? current.filter((value) => value !== courseId)
        : [...current, courseId]
    });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (validation) return notify(validation, 'error');
    setSaving(true);
    try {
      const activeControls = controls.map((control, index) => ({ ...control, orden: (index + 1) * 10 }));
      const primary = activeControls.find((control) => control.tipo === 'INGRESO') || activeControls[0];
      const response = await axios.put(`${API_URL}/puntualidad/config`, {
        ...general,
        hora_entrada: primary.hora_referencia,
        hora_limite_atraso: primary.hora_inicio_atraso,
        minutos_atraso_grave: Number(primary.minutos_atraso_grave),
        umbral_alerta: Number(general.umbral_alerta),
        umbral_critico: Number(general.umbral_critico),
        controles: activeControls,
        motivo_cambio: 'Actualización de la jornada y sus controles horarios'
      });
      setControls(response.data.config.controles.filter((control) => control.activo).map(normalizeControl));
      setSavedAt(response.data.config.actualizado_en);
      notify('Jornada y controles guardados con versión histórica.', 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar los controles horarios.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => { await logout(); navigate('/login'); };
  const sortedPreview = [...controls].sort((a, b) => String(a.hora_referencia).localeCompare(String(b.hora_referencia)));

  return (
    <div className="app-container settings-page">
      <div className="settings-surface">
        <ModuleHeader
          icon={Settings2}
          title="Controles de puntualidad"
          description="Define los momentos de la jornada en que se registra puntualidad: ingreso, recreos, almuerzo y actividades."
          onBack={() => navigate('/admin')}
          onLogout={handleLogout}
        />

        {loading ? <div className="settings-loading">Cargando jornada institucional…</div> : (
          <form className="settings-layout settings-layout--controls" onSubmit={handleSave} data-tour="punctuality-settings">
            <main className="settings-form-area">
              <section className="settings-section">
                <div className="settings-section__heading">
                  <span>01</span>
                  <div><h2>Jornada institucional</h2><p>Identifica el conjunto de controles y define cuándo se activan las alertas de recurrencia.</p></div>
                </div>
                <div className="settings-grid">
                  <label className="settings-field">
                    <span>Nombre de la jornada</span>
                    <input type="text" maxLength="80" value={general.nombre_jornada} onChange={(event) => setGeneral({ ...general, nombre_jornada: event.target.value })} />
                  </label>
                  <label className="settings-field">
                    <span>Alerta preventiva</span>
                    <div className="number-field"><input type="number" min="1" max="50" value={general.umbral_alerta} onChange={(event) => setGeneral({ ...general, umbral_alerta: event.target.value })} /><span>atrasos</span></div>
                  </label>
                  <label className="settings-field">
                    <span>Alerta crítica</span>
                    <div className="number-field"><input type="number" min="2" max="100" value={general.umbral_critico} onChange={(event) => setGeneral({ ...general, umbral_critico: event.target.value })} /><span>atrasos</span></div>
                  </label>
                </div>
              </section>

              <section className="settings-section controls-builder" data-tour="punctuality-controls">
                <div className="settings-section__heading controls-builder__heading">
                  <span>02</span>
                  <div><h2>Controles de la jornada</h2><p>Cada control genera un registro independiente y conserva la regla exacta aplicada.</p></div>
                  <button type="button" className="control-add-button" onClick={addControl}><Plus size={18} /> Agregar control</button>
                </div>

                <div className="control-list">
                  {controls.map((control, index) => {
                    const key = control.id || `new-${index}`;
                    const expanded = expandedId === key;
                    const severeAt = minutesToClock((clockMinutes(control.hora_inicio_atraso) || 0) + Number(control.minutos_atraso_grave || 0));
                    return (
                      <article className={`control-editor ${expanded ? 'is-expanded' : ''}`} key={key}>
                        <button type="button" className="control-editor__summary" onClick={() => setExpandedId(expanded ? null : key)}>
                          <span className="control-editor__number">{String(index + 1).padStart(2, '0')}</span>
                          <span className="control-editor__identity">
                            <strong>{control.nombre}</strong>
                            <small>{CONTROL_TYPES.find((type) => type.value === control.tipo)?.label} · {control.hora_referencia} · {control.cursos_ids.length ? `${control.cursos_ids.length} cursos` : 'Todos los cursos'}</small>
                          </span>
                          <span className="control-editor__band">Atraso {control.hora_inicio_atraso} · grave {severeAt}</span>
                        </button>

                        {expanded && (
                          <div className="control-editor__body">
                            <div className="settings-grid settings-grid--two">
                              <label className="settings-field"><span>Nombre visible</span><input maxLength="100" value={control.nombre} onChange={(event) => updateControl(index, { nombre: event.target.value })} /></label>
                              <div className="settings-field"><span>Tipo de control</span><AppSelect ariaLabel="Tipo de control" value={control.tipo} onChange={(value) => updateControl(index, { tipo: value })} options={CONTROL_TYPES} /></div>
                            </div>

                            <div className="control-time-grid">
                              {[
                                ['hora_apertura', 'Apertura', 'Desde cuándo acepta registros'],
                                ['hora_referencia', 'Hora esperada', 'Referencia institucional'],
                                ['hora_inicio_atraso', 'Inicio del atraso', 'Desde esta hora cuenta atraso'],
                                ['hora_cierre', 'Cierre', 'Después exige otro control']
                              ].map(([field, label, helper]) => (
                                <div className="settings-field" key={field}><span>{label}</span><TimeField ariaLabel={`${label} de ${control.nombre}`} value={control[field]} onChange={(value) => updateControl(index, { [field]: value })} /><small>{helper}</small></div>
                              ))}
                            </div>

                            <div className="control-options-grid">
                              <label className="settings-field"><span>Grave después de</span><div className="number-field"><input type="number" min="1" max="180" value={control.minutos_atraso_grave} onChange={(event) => updateControl(index, { minutos_atraso_grave: Number(event.target.value) })} /><span>min</span></div></label>
                              <label className="control-check"><input type="checkbox" checked={control.cuenta_alertas} onChange={(event) => updateControl(index, { cuenta_alertas: event.target.checked })} /><span><strong>Contar para alertas</strong><small>Incluye estos atrasos en seguimiento preventivo.</small></span></label>
                            </div>

                            <div className="control-scope">
                              <span className="settings-field__label"><CalendarDays size={15} /> Días de aplicación</span>
                              <div className="control-chip-row">{DAYS.map((day) => <button type="button" className={control.dias_semana.includes(day.value) ? 'is-selected' : ''} onClick={() => toggleDay(index, day.value)} key={day.value}>{day.label}</button>)}</div>
                            </div>

                            <div className="control-scope">
                              <span className="settings-field__label">Cursos incluidos</span>
                              <p>{control.cursos_ids.length === 0 ? 'Se aplica a toda la matrícula. Selecciona cursos solamente si este horario es específico.' : 'Aplicación limitada a los cursos marcados.'}</p>
                              <div className="control-chip-row control-chip-row--courses">
                                <button type="button" className={control.cursos_ids.length === 0 ? 'is-selected' : ''} onClick={() => updateControl(index, { cursos_ids: [] })}>Todos</button>
                                {courses.map((course) => {
                                  const id = Number(course.id_curso);
                                  return <button type="button" className={control.cursos_ids.includes(id) ? 'is-selected' : ''} onClick={() => toggleCourse(index, id)} key={id}>{course.nombre_curso}</button>;
                                })}
                              </div>
                            </div>

                            <div className="control-editor__actions">
                              <button type="button" onClick={() => duplicateControl(index)}><Copy size={16} /> Duplicar</button>
                              <button type="button" className="is-danger" onClick={() => removeControl(index)}><Trash2 size={16} /> {control.id ? 'Desactivar' : 'Quitar'}</button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>

              {validation && <div className="settings-validation" role="alert"><AlertTriangle size={19} /><span>{validation}</span></div>}
              <div className="settings-submit-row">
                <div><strong>Cambios auditables y versionados</strong><span>{savedAt ? `Última actualización: ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(savedAt))}` : 'Sin actualización previa'}</span></div>
                <button type="submit" disabled={saving || Boolean(validation)}><Save size={19} /> {saving ? 'Guardando…' : 'Guardar jornada'}</button>
              </div>
            </main>

            <aside className="settings-preview controls-preview" aria-label="Vista previa de la jornada" data-tour="punctuality-preview">
              <span className="section-kicker">Vista previa operativa</span>
              <h2>Línea de tiempo del día</h2>
              <p className="controls-preview__intro">El lector propondrá automáticamente el control cuya ventana esté activa.</p>
              <div className="controls-timeline">
                {sortedPreview.map((control, index) => (
                  <article key={control.id || `${control.nombre}-${index}`}>
                    <div className="controls-timeline__rail"><i /><span /></div>
                    <div className="controls-timeline__content">
                      <small>{control.hora_apertura} — {control.hora_cierre}</small>
                      <strong>{control.nombre}</strong>
                      <span>Esperado {control.hora_referencia} · atraso {control.hora_inicio_atraso}</span>
                      <em>{control.cursos_ids.length ? `${control.cursos_ids.length} cursos` : 'Todos los cursos'} · {control.cuenta_alertas ? 'suma alertas' : 'solo registro'}</em>
                    </div>
                  </article>
                ))}
              </div>
              <div className="settings-preview__alerts"><h3><BellRing size={18} /> Seguimiento acumulado</h3><p><strong>{general.umbral_alerta}</strong> atrasos generan seguimiento preventivo.</p><p><strong>{general.umbral_critico}</strong> atrasos generan seguimiento crítico.</p></div>
              <div className="settings-preview__notice"><ShieldAlert size={18} /><span>Inspectoría puede cambiar el control sugerido únicamente con el permiso correspondiente y dejando un motivo en auditoría.</span></div>
              <div className="settings-preview__notice"><Info size={18} /><span>Los registros anteriores conservan nombre, horarios, gravedad y versión aunque esta jornada cambie.</span></div>
              <div className="settings-preview__status"><CheckCircle2 size={18} /><span>Zona horaria institucional: America/Santiago</span></div>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
};

export default PunctualitySettings;
