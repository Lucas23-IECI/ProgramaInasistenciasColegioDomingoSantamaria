import React, { useCallback, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, ContactRound, Save, Search, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { AuthContext } from './context/AuthContext';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';
import AppSelect from './components/AppSelect';
import { getApiErrorMessage } from './utils/apiError';

const RESPONSIBILITIES = [
  { value: 'PRINCIPAL', label: 'Responsable principal' },
  { value: 'SUPLENTE', label: 'Responsable suplente' },
  { value: 'AUTORIZADO', label: 'Persona autorizada' }
];

const FamilyDirectory = () => {
  const navigate = useNavigate();
  const { logout } = useContext(AuthContext);
  const { notify } = useFeedback();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reasonByLink, setReasonByLink] = useState({});
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (value = query) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/familias', { params: { q: value.trim() } });
      setPeople(response.data);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible buscar las fichas.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, query]);

  useEffect(() => { search(''); }, [search]);

  const openPerson = async (id) => {
    try {
      const response = await axios.get(`/api/familias/${id}`);
      setSelected(response.data);
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible abrir la ficha.'), 'error');
    }
  };

  const updatePerson = (patch) => setSelected((current) => ({
    ...current,
    person: { ...current.person, ...patch }
  }));
  const updateLink = (id, patch) => setSelected((current) => ({
    ...current,
    students: current.students.map((student) => student.id === id ? { ...student, ...patch } : student)
  }));

  const savePerson = async () => {
    try {
      const response = await axios.put(`/api/familias/${selected.person.id}`, selected.person);
      updatePerson(response.data);
      notify('Ficha familiar actualizada.', 'success');
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible actualizar la ficha.'), 'error');
    }
  };

  const saveLink = async (link) => {
    const reason = reasonByLink[link.id]?.trim() || '';
    try {
      await axios.patch(`/api/familias/vinculos/${link.id}`, {
        ...link,
        motivo_cambio: reason
      });
      notify('Vínculo actualizado y registrado en historial.', 'success');
      await openPerson(selected.person.id);
      setReasonByLink((current) => ({ ...current, [link.id]: '' }));
    } catch (error) {
      notify(getApiErrorMessage(error, 'No fue posible actualizar el vínculo.'), 'error');
    }
  };

  return (
    <div className="students-page">
      <div className="students-card">
        <ModuleHeader
          icon={ContactRound}
          title="Ficha familiar"
          description="Responsables, estudiantes vinculados, vigencias y restricciones con trazabilidad."
          onBack={() => navigate('/admin/estudiantes')}
          backLabel="Personas y cursos"
          onLogout={async () => { await logout(); navigate('/login'); }}
        />

        {!selected ? (
          <main className="family-directory" data-tour="family-directory">
            <section className="family-search">
              <div>
                <span className="section-kicker">Responsables y autorizados</span>
                <h2>Buscar una ficha</h2>
                <p>Busca por nombre o documento. Una persona puede estar vinculada con varios hermanos.</p>
              </div>
              <form onSubmit={(event) => { event.preventDefault(); search(); }}>
                <Search size={19} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o RUT" />
                <button type="submit" disabled={loading}>Buscar</button>
              </form>
            </section>
            <section className="family-results">
              {people.map((person) => (
                <button type="button" key={person.id} onClick={() => openPerson(person.id)}>
                  <span className="family-avatar">{person.nombre_completo.split(/\s+/).slice(0, 2).map((value) => value[0]).join('')}</span>
                  <span><strong>{person.nombre_completo}</strong><small>{person.documento_numero}</small></span>
                  <span>{person.vinculos_vigentes} vínculo(s) vigente(s)</span>
                </button>
              ))}
            </section>
          </main>
        ) : (
          <main className="family-detail" data-tour="family-detail">
            <button type="button" className="family-back" onClick={() => setSelected(null)}><ArrowLeft size={17} /> Volver al directorio</button>
            <section className="family-person">
              <header><span className="section-kicker">Persona responsable</span><h2>{selected.person.nombre_completo}</h2></header>
              <label>Nombre completo<input value={selected.person.nombre_completo || ''} onChange={(event) => updatePerson({ nombre_completo: event.target.value })} /></label>
              <label>Teléfono<input value={selected.person.telefono || ''} onChange={(event) => updatePerson({ telefono: event.target.value })} /></label>
              <label>Teléfono de emergencia<input value={selected.person.telefono_emergencia || ''} onChange={(event) => updatePerson({ telefono_emergencia: event.target.value })} /></label>
              <label>Correo<input type="email" value={selected.person.email || ''} onChange={(event) => updatePerson({ email: event.target.value })} /></label>
              <label className="family-wide">Restricciones autorizadas<textarea value={selected.person.restricciones || ''} onChange={(event) => updatePerson({ restricciones: event.target.value })} /></label>
              <label className="family-wide">Observaciones familiares<textarea value={selected.person.observaciones_familiares || ''} onChange={(event) => updatePerson({ observaciones_familiares: event.target.value })} /></label>
              <button type="button" className="primary-action" onClick={savePerson}><Save size={17} /> Guardar ficha</button>
            </section>

            <section className="family-links">
              <header><span className="section-kicker">Estudiantes vinculados</span><h2>{selected.students.length} relación(es) registradas</h2></header>
              {selected.students.map((link) => (
                <article key={link.id}>
                  <div className="family-link__identity">
                    <ShieldCheck size={21} />
                    <span><strong>{link.estudiante}</strong><small>{link.nombre_curso || 'Sin matrícula vigente'}</small></span>
                  </div>
                  <label>Responsabilidad
                    <AppSelect value={link.tipo_responsabilidad} onChange={(value) => updateLink(link.id, { tipo_responsabilidad: value })} options={RESPONSIBILITIES} />
                  </label>
                  <label>Vigente desde<input type="date" value={String(link.vigente_desde || '').slice(0, 10)} onChange={(event) => updateLink(link.id, { vigente_desde: event.target.value })} /></label>
                  <label>Vigente hasta<input type="date" value={String(link.vigente_hasta || '').slice(0, 10)} onChange={(event) => updateLink(link.id, { vigente_hasta: event.target.value })} /></label>
                  <label className="configuration-check"><input type="checkbox" checked={link.activo} onChange={(event) => updateLink(link.id, { activo: event.target.checked })} /> Vínculo activo</label>
                  <label className="family-wide">Restricciones<input value={link.restricciones || ''} onChange={(event) => updateLink(link.id, { restricciones: event.target.value })} /></label>
                  <label className="family-wide">Motivo obligatorio del cambio<input value={reasonByLink[link.id] || ''} onChange={(event) => setReasonByLink((current) => ({ ...current, [link.id]: event.target.value }))} /></label>
                  <button type="button" className="secondary-action" onClick={() => saveLink(link)}>Guardar vínculo</button>
                  {Array.isArray(link.historial) && link.historial.length > 0 && (
                    <details className="family-history"><summary>Ver historial ({link.historial.length})</summary>
                      {link.historial.map((event, index) => <p key={`${event.realizado_en}-${index}`}><strong>{event.accion}</strong> · {event.motivo}</p>)}
                    </details>
                  )}
                </article>
              ))}
            </section>
          </main>
        )}
      </div>
    </div>
  );
};

export default FamilyDirectory;
