import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CheckCircle2, Clock3, Info, ListChecks, Plus, Save, Settings2, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';

const CATALOGS = {
  'motivos-visita': {
    label: 'Motivos de visita',
    description: 'Razones informadas por una persona externa al ingresar al establecimiento.',
  },
  destinos: {
    label: 'Destinos',
    description: 'Áreas o dependencias a las que puede dirigirse una visita.',
  },
  'motivos-retiro': {
    label: 'Motivos de retiro',
    description: 'Motivos institucionales disponibles al registrar el retiro de estudiantes.',
  },
  parentescos: {
    label: 'Relaciones familiares',
    description: 'Vínculos que identifican la relación entre una persona responsable y el estudiante.',
  },
};

const VisitSettingsAdmin = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [activeCatalog, setActiveCatalog] = useState('motivos-visita');
  const [drafts, setDrafts] = useState({});
  const [newItem, setNewItem] = useState({ nombre: '', orden: 100, requisito_adicional: false });
  const [savingAction, setSavingAction] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await axios.get('/api/configuracion-visitas');
      setData(response.data);
      const normalized = {};
      Object.entries(response.data.catalogs || {}).forEach(([key, values]) => {
        normalized[key] = Object.fromEntries(values.map((item) => [item.codigo, { ...item }]));
      });
      setDrafts(normalized);
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible cargar la configuración.', 'error');
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => Object.values(drafts[activeCatalog] || {}).sort((left, right) => (
    Number(left.orden) - Number(right.orden) || left.nombre.localeCompare(right.nombre, 'es')
  )), [drafts, activeCatalog]);
  const activeCatalogInfo = CATALOGS[activeCatalog];

  const updateDraft = (code, patch) => {
    setDrafts((current) => ({
      ...current,
      [activeCatalog]: {
        ...current[activeCatalog],
        [code]: { ...current[activeCatalog][code], ...patch },
      },
    }));
  };

  const saveGeneral = async () => {
    setSavingAction('general');
    try {
      const response = await axios.put('/api/configuracion-visitas/general', data.general);
      setData((current) => ({ ...current, general: response.data }));
      notify('Reglas operativas actualizadas.', 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar las reglas.', 'error');
    } finally {
      setSavingAction('');
    }
  };

  const saveItem = async (item) => {
    setSavingAction(item.codigo);
    try {
      await axios.put(`/api/configuracion-visitas/catalogos/${activeCatalog}/${item.codigo}`, {
        nombre: item.nombre,
        activo: item.activo,
        orden: Number(item.orden),
        requiere_detalle: item.requisito_adicional,
        requiere_contacto: item.requisito_adicional,
      });
      notify('Elemento actualizado.', 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible actualizar el elemento.', 'error');
    } finally {
      setSavingAction('');
    }
  };

  const createItem = async () => {
    if (newItem.nombre.trim().length < 2) {
      notify('Escribe un nombre para el nuevo elemento.', 'error');
      return;
    }
    setSavingAction('new');
    try {
      await axios.post(`/api/configuracion-visitas/catalogos/${activeCatalog}`, {
        nombre: newItem.nombre.trim(),
        orden: Number(newItem.orden),
        requiere_detalle: newItem.requisito_adicional,
        requiere_contacto: newItem.requisito_adicional,
      });
      setNewItem({ nombre: '', orden: 100, requisito_adicional: false });
      notify('Elemento creado.', 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible crear el elemento.', 'error');
    } finally {
      setSavingAction('');
    }
  };

  if (!data) return <div className="route-loader">Cargando configuración…</div>;

  return (
    <div className="visit-settings-page">
      <div className="visit-settings-surface">
        <ModuleHeader
          icon={Settings2}
          title="Configuración de visitas y retiros"
          description="Catálogos y reglas operativas administrables, sin modificar registros históricos."
          onBack={() => navigate('/admin/visitas')}
          backLabel="Visitas y retiros"
          onLogout={async () => { await logout(); navigate('/login'); }}
        />

        <main className="visit-settings-content">
          <section className="visit-settings-general" data-tour="visits-general-settings">
            <div className="visit-settings-section-heading">
              <span className="visit-settings-section-heading__icon" aria-hidden="true"><ShieldCheck size={22} /></span>
              <div>
                <span className="section-kicker">Reglas generales</span>
                <h2>Operación de Portería</h2>
                <p>Configura los controles comunes de acceso. Cada cambio queda registrado en auditoría.</p>
              </div>
            </div>

            <div className="visit-settings-general__grid">
              <label className="visit-settings-field">
                <span><Clock3 size={16} /> Hora de revisión de cierre</span>
                <input
                  type="time"
                  value={String(data.general.hora_cierre || '').slice(0, 5)}
                  onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, hora_cierre: event.target.value } }))}
                />
                <small>Momento sugerido para revisar visitas y retiros todavía abiertos.</small>
              </label>
              <label className="visit-settings-field">
                <span><Clock3 size={16} /> Duración máxima de una visita</span>
                <div className="visit-settings-input-suffix">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={data.general.max_horas_visita}
                    onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, max_horas_visita: Number(event.target.value) } }))}
                  />
                  <span>horas</span>
                </div>
                <small>Superado este tiempo, la visita aparecerá como tarea por resolver.</small>
              </label>
              <div className="visit-settings-switches" role="group" aria-label="Controles de seguridad">
                <label className="visit-settings-switch">
                  <input
                    type="checkbox"
                    checked={data.general.exigir_documento_fisico}
                    onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, exigir_documento_fisico: event.target.checked } }))}
                  />
                  <span><strong>Verificar documento físico</strong><small>Solicita comprobación presencial al registrar el ingreso.</small></span>
                </label>
                <label className="visit-settings-switch">
                  <input
                    type="checkbox"
                    checked={data.general.permitir_retiro_excepcional}
                    onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, permitir_retiro_excepcional: event.target.checked } }))}
                  />
                  <span><strong>Permitir retiro excepcional</strong><small>Habilita excepciones justificadas y completamente auditadas.</small></span>
                </label>
              </div>
            </div>

            <div className="visit-settings-savebar">
              <span><Info size={16} /> Las reglas nuevas no alteran registros históricos.</span>
              <button type="button" className="visit-settings-button visit-settings-button--primary" onClick={saveGeneral} disabled={Boolean(savingAction)}>
                <Save size={17} /> {savingAction === 'general' ? 'Guardando…' : 'Guardar reglas'}
              </button>
            </div>
          </section>

          <section className="visit-settings-catalogs" data-tour="visits-catalogs">
            <div className="visit-settings-section-heading">
              <span className="visit-settings-section-heading__icon" aria-hidden="true"><ListChecks size={22} /></span>
              <div>
                <span className="section-kicker">Catálogos institucionales</span>
                <h2>Opciones disponibles en los formularios</h2>
                <p>Ordena, activa o desactiva las alternativas que utiliza el personal de Portería.</p>
              </div>
            </div>

            <nav className="visit-settings-tabs" aria-label="Catálogos" role="tablist">
              {Object.entries(CATALOGS).map(([key, catalog]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeCatalog === key}
                  key={key}
                  onClick={() => setActiveCatalog(key)}
                >
                  {catalog.label}
                </button>
              ))}
            </nav>

            <div className="visit-settings-catalog-intro">
              <div>
                <strong>{activeCatalogInfo.label}</strong>
                <p>{activeCatalogInfo.description}</p>
              </div>
              <span>{items.length} {items.length === 1 ? 'opción' : 'opciones'}</span>
            </div>

            <div className="visit-settings-create">
              <div className="visit-settings-create__heading">
                <Plus size={19} aria-hidden="true" />
                <div><strong>Agregar una opción</strong><span>Se incorporará al catálogo seleccionado.</span></div>
              </div>
              <label className="visit-settings-field visit-settings-field--name"><span>Nombre</span>
                <input value={newItem.nombre} onChange={(event) => setNewItem({ ...newItem, nombre: event.target.value })} maxLength={120} placeholder="Ej: Entrevista con orientación" />
              </label>
              <label className="visit-settings-field"><span>Orden</span>
                <input type="number" min="0" max="9999" value={newItem.orden} onChange={(event) => setNewItem({ ...newItem, orden: event.target.value })} />
              </label>
              <label className="visit-settings-switch visit-settings-switch--compact">
                <input type="checkbox" checked={newItem.requisito_adicional} onChange={(event) => setNewItem({ ...newItem, requisito_adicional: event.target.checked })} />
                <span><strong>Exigir detalle</strong><small>Pedirá información adicional.</small></span>
              </label>
              <button type="button" className="visit-settings-button visit-settings-button--primary" onClick={createItem} disabled={Boolean(savingAction)}>
                <Plus size={17} /> {savingAction === 'new' ? 'Agregando…' : 'Agregar'}
              </button>
            </div>

            <div className="visit-settings-list" role="list" aria-label={`Opciones de ${activeCatalogInfo.label}`}>
              {items.map((item) => (
                <article key={item.codigo} role="listitem" className="visit-settings-item">
                  <div className="visit-settings-item__identity">
                    <span className={`visit-settings-item__status ${item.activo ? 'is-active' : ''}`} aria-hidden="true"><CheckCircle2 size={17} /></span>
                    <div><strong>{item.nombre}</strong><span>Código interno: {item.codigo}</span></div>
                  </div>
                  <label className="visit-settings-field visit-settings-field--order"><span>Orden</span><input aria-label={`Orden de ${item.nombre}`} type="number" min="0" max="9999" value={item.orden} onChange={(event) => updateDraft(item.codigo, { orden: event.target.value })} /></label>
                  <label className="visit-settings-switch visit-settings-switch--compact"><input type="checkbox" checked={item.requisito_adicional} onChange={(event) => updateDraft(item.codigo, { requisito_adicional: event.target.checked })} /><span><strong>Exigir detalle</strong><small>Solicita contexto adicional.</small></span></label>
                  <label className="visit-settings-switch visit-settings-switch--compact"><input type="checkbox" checked={item.activo} onChange={(event) => updateDraft(item.codigo, { activo: event.target.checked })} /><span><strong>{item.activo ? 'Activo' : 'Inactivo'}</strong><small>{item.activo ? 'Visible en formularios.' : 'Oculto en nuevos registros.'}</small></span></label>
                  <button type="button" className="visit-settings-button visit-settings-button--secondary" onClick={() => saveItem(item)} disabled={Boolean(savingAction)}>
                    <Save size={16} /> {savingAction === item.codigo ? 'Guardando…' : 'Guardar'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default VisitSettingsAdmin;
