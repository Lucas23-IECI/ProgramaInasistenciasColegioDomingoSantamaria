import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Plus, Save, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';

const CATALOG_LABELS = {
  'motivos-visita': 'Motivos de visita',
  destinos: 'Destinos',
  'motivos-retiro': 'Motivos de retiro',
  parentescos: 'Relaciones familiares'
};

const VisitSettingsAdmin = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [data, setData] = useState(null);
  const [activeCatalog, setActiveCatalog] = useState('motivos-visita');
  const [drafts, setDrafts] = useState({});
  const [newItem, setNewItem] = useState({ nombre: '', orden: 100, requisito_adicional: false });
  const [saving, setSaving] = useState(false);

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
  const items = useMemo(() => Object.values(drafts[activeCatalog] || {}), [drafts, activeCatalog]);

  const updateDraft = (code, patch) => {
    setDrafts((current) => ({
      ...current,
      [activeCatalog]: {
        ...current[activeCatalog],
        [code]: { ...current[activeCatalog][code], ...patch }
      }
    }));
  };

  const saveGeneral = async () => {
    setSaving(true);
    try {
      const response = await axios.put('/api/configuracion-visitas/general', data.general);
      setData((current) => ({ ...current, general: response.data }));
      notify('Reglas operativas actualizadas.', 'success');
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible guardar las reglas.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveItem = async (item) => {
    setSaving(true);
    try {
      await axios.put(`/api/configuracion-visitas/catalogos/${activeCatalog}/${item.codigo}`, {
        nombre: item.nombre,
        activo: item.activo,
        orden: Number(item.orden),
        requiere_detalle: item.requisito_adicional,
        requiere_contacto: item.requisito_adicional
      });
      notify('Elemento actualizado.', 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible actualizar el elemento.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const createItem = async () => {
    if (newItem.nombre.trim().length < 2) {
      notify('Escribe un nombre para el nuevo elemento.', 'error');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/api/configuracion-visitas/catalogos/${activeCatalog}`, {
        nombre: newItem.nombre.trim(),
        orden: Number(newItem.orden),
        requiere_detalle: newItem.requisito_adicional,
        requiere_contacto: newItem.requisito_adicional
      });
      setNewItem({ nombre: '', orden: 100, requisito_adicional: false });
      notify('Elemento creado.', 'success');
      await load();
    } catch (error) {
      notify(error.response?.data?.message || 'No fue posible crear el elemento.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <div className="route-loader">Cargando configuración…</div>;

  return (
    <div className="students-page">
      <div className="students-card">
        <ModuleHeader
          icon={Settings2}
          title="Configuración de visitas y retiros"
          description="Catálogos y reglas operativas administrables, sin modificar registros históricos."
          onBack={() => navigate('/admin/visitas')}
          backLabel="Visitas y retiros"
          onLogout={async () => { await logout(); navigate('/login'); }}
        />

        <section className="configuration-band" data-tour="visits-general-settings">
          <div className="configuration-band__heading">
            <span className="section-kicker">Reglas generales</span>
            <h2>Operación de Portería</h2>
            <p>Define controles comunes. Los cambios quedan registrados en auditoría.</p>
          </div>
          <label>Hora de revisión de cierre
            <input
              type="time"
              value={String(data.general.hora_cierre || '').slice(0, 5)}
              onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, hora_cierre: event.target.value } }))}
            />
          </label>
          <label>Máximo de horas de una visita
            <input
              type="number"
              min="1"
              max="24"
              value={data.general.max_horas_visita}
              onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, max_horas_visita: Number(event.target.value) } }))}
            />
          </label>
          <label className="configuration-check">
            <input
              type="checkbox"
              checked={data.general.exigir_documento_fisico}
              onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, exigir_documento_fisico: event.target.checked } }))}
            />
            Verificar documento físico
          </label>
          <label className="configuration-check">
            <input
              type="checkbox"
              checked={data.general.permitir_retiro_excepcional}
              onChange={(event) => setData((current) => ({ ...current, general: { ...current.general, permitir_retiro_excepcional: event.target.checked } }))}
            />
            Permitir retiro excepcional con trazabilidad
          </label>
          <button type="button" className="primary-action" onClick={saveGeneral} disabled={saving}><Save size={17} /> Guardar reglas</button>
        </section>

        <section className="catalog-manager" data-tour="visits-catalogs">
          <header>
            <span className="section-kicker">Catálogos institucionales</span>
            <h2>Opciones disponibles en los formularios</h2>
          </header>
          <nav className="catalog-tabs" aria-label="Catálogos">
            {Object.entries(CATALOG_LABELS).map(([key, label]) => (
              <button type="button" key={key} data-active={activeCatalog === key || undefined} onClick={() => setActiveCatalog(key)}>{label}</button>
            ))}
          </nav>

          <div className="catalog-new">
            <label>Nuevo nombre
              <input value={newItem.nombre} onChange={(event) => setNewItem({ ...newItem, nombre: event.target.value })} maxLength={120} />
            </label>
            <label>Orden
              <input type="number" min="0" max="9999" value={newItem.orden} onChange={(event) => setNewItem({ ...newItem, orden: event.target.value })} />
            </label>
            <label className="configuration-check">
              <input type="checkbox" checked={newItem.requisito_adicional} onChange={(event) => setNewItem({ ...newItem, requisito_adicional: event.target.checked })} />
              Exigir información adicional
            </label>
            <button type="button" className="primary-action" onClick={createItem} disabled={saving}><Plus size={17} /> Agregar</button>
          </div>

          <div className="catalog-list">
            {items.map((item) => (
              <article key={item.codigo}>
                <div><strong>{item.nombre}</strong><span>{item.codigo}</span></div>
                <label>Orden<input type="number" value={item.orden} onChange={(event) => updateDraft(item.codigo, { orden: event.target.value })} /></label>
                <label className="configuration-check"><input type="checkbox" checked={item.requisito_adicional} onChange={(event) => updateDraft(item.codigo, { requisito_adicional: event.target.checked })} /> Exigir detalle</label>
                <label className="configuration-check"><input type="checkbox" checked={item.activo} onChange={(event) => updateDraft(item.codigo, { activo: event.target.checked })} /> Activo</label>
                <button type="button" className="secondary-action" onClick={() => saveItem(item)} disabled={saving}>Guardar</button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default VisitSettingsAdmin;
