import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { ArrowRight, Building2, ContactRound, MapPin, RotateCcw, Search, SlidersHorizontal, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { API_URL } from './config';
import { useFeedback } from './context/FeedbackContext';
import ModuleHeader from './components/ModuleHeader';
import StaffAvatar from './components/StaffAvatar';
import { getApiErrorMessage } from './utils/apiError';

const STATUS_LABELS = {
  SIN_ESTADO: 'Sin estado',
  DISPONIBLE: 'Disponible',
  OCUPADO: 'Ocupado/a',
  EN_REUNION: 'En reunión',
  EN_TERRENO: 'En terreno',
  FUERA: 'Fuera',
  AUSENTE: 'Ausente',
  NO_MOLESTAR: 'No molestar'
};

const EMPTY_FILTERS = { areas: [], cargos: [], statuses: [], account_types: [] };

const StaffDirectory = () => {
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [cargo, setCargo] = useState('');
  const [status, setStatus] = useState('');
  const [accountType, setAccountType] = useState('');
  const [sort, setSort] = useState('name_asc');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(() => (
    typeof window === 'undefined' || !window.matchMedia('(max-width: 680px)').matches
  ));

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      axios.get(`${API_URL}/directory/staff`, {
        params: { search, area, cargo, status, account_type: accountType, sort },
        signal: controller.signal
      })
        .then(({ data }) => {
          setRows(data.rows || []);
          setFilters(data.filters || EMPTY_FILTERS);
          setTotal(Number.isInteger(data.total) ? data.total : (data.rows || []).length);
        })
        .catch((error) => {
          if (error.code !== 'ERR_CANCELED') notify(getApiErrorMessage(error, 'No fue posible cargar el directorio.'), 'error');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, search ? 220 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [accountType, area, cargo, notify, search, sort, status]);

  const filtersActive = Boolean(search || area || cargo || status || accountType || sort !== 'name_asc');
  const clearFilters = () => {
    setSearch('');
    setArea('');
    setCargo('');
    setStatus('');
    setAccountType('');
    setSort('name_asc');
  };

  const grouped = useMemo(() => rows.reduce((result, person) => {
    const key = person.area || 'Equipo institucional';
    if (!result[key]) result[key] = [];
    result[key].push(person);
    return result;
  }, {}), [rows]);

  return (
    <main className="staff-directory-page">
      <ModuleHeader
        icon={ContactRound}
        title="Directorio interno"
        description="Encuentra a una persona del equipo por nombre, cargo o área."
        onBack={() => navigate('/admin')}
      />

      <section className="staff-directory-toolbar" aria-label="Buscar y filtrar el directorio" data-tour="staff-directory-search">
        <div className="staff-directory-searchline">
          <label className="staff-directory-search">
            <Search size={20} aria-hidden="true" />
            <span className="sr-only">Buscar persona</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, cargo, área, perfil o ubicación" />
          </label>
          <span className="staff-directory-count" aria-live="polite">
            {loading ? 'Buscando...' : `${rows.length} de ${total} ${total === 1 ? 'persona' : 'personas'}`}
          </span>
        </div>
        <div className="staff-directory-filters" data-open={filtersOpen}>
          <button type="button" className="staff-directory-filters__title" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen} aria-controls="staff-directory-filter-fields"><SlidersHorizontal size={17} /> {filtersOpen ? 'Ocultar filtros' : 'Mostrar filtros'}</button>
          <div className="staff-directory-filter-fields" id="staff-directory-filter-fields">
          <label><span>Área</span><select aria-label="Área" value={area} onChange={(event) => setArea(event.target.value)}><option value="">Todas las áreas</option>{filters.areas.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label><span>Cargo</span><select aria-label="Cargo" value={cargo} onChange={(event) => setCargo(event.target.value)}><option value="">Todos los cargos</option>{filters.cargos.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label><span>Disponibilidad</span><select aria-label="Disponibilidad" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos los estados</option>{filters.statuses.map((option) => <option key={option} value={option}>{STATUS_LABELS[option] || option}</option>)}</select></label>
          <label><span>Tipo de cuenta</span><select aria-label="Tipo de cuenta" value={accountType} onChange={(event) => setAccountType(event.target.value)}><option value="">Todas las cuentas</option><option value="personal">Personales</option><option value="shared">Puestos compartidos</option></select></label>
          <label><span>Ordenar</span><select aria-label="Ordenar" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name_asc">Nombre A–Z</option><option value="name_desc">Nombre Z–A</option><option value="area">Área</option><option value="status">Disponibilidad</option></select></label>
          <button type="button" className="staff-directory-clear" onClick={clearFilters} disabled={!filtersActive}><RotateCcw size={16} /> Limpiar</button>
          </div>
        </div>
      </section>

      {!loading && rows.length === 0 ? (
        <section className="staff-directory-empty">
          <UsersRound size={34} />
          <h2>No encontramos coincidencias</h2>
          <p>Prueba otra búsqueda o limpia los filtros aplicados.</p>
          {filtersActive && <button type="button" className="staff-directory-clear staff-directory-clear--empty" onClick={clearFilters}><RotateCcw size={16} /> Limpiar filtros</button>}
        </section>
      ) : (
        <div className="staff-directory-groups" data-tour="staff-directory-list">
          {Object.entries(grouped).map(([area, people]) => (
            <section className="staff-directory-group" key={area}>
              <header><Building2 size={18} /><h2>{area}</h2><span>{people.length}</span></header>
              <div className="staff-directory-list">
                {people.map((person) => (
                  <button type="button" className="staff-directory-row" key={person.usuario_id} onClick={() => navigate(`/directorio/${person.usuario_id}`)}>
                    <StaffAvatar profile={person} name={person.nombre_mostrado} size="lg" />
                    <span className="staff-directory-row__identity">
                      <strong>{person.nombre_mostrado}</strong>
                      <small>{person.cargo || person.perfil_acceso}</small>
                    </span>
                    <span className="staff-directory-row__location">
                      {person.ubicacion && <><MapPin size={15} /> {person.ubicacion}</>}
                    </span>
                    <span className="staff-status" data-status={person.estado_disponibilidad}>{STATUS_LABELS[person.estado_disponibilidad] || 'Sin estado'}</span>
                    <ArrowRight className="staff-directory-row__arrow" size={19} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
};

export default StaffDirectory;
