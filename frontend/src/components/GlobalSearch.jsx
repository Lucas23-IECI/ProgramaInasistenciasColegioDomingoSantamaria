import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, LockKeyhole, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { getApiErrorMessage } from '../utils/apiError';

const MIN_QUERY_LENGTH = 2;
const EMPTY_RESULTS = Object.freeze({ groups: [], total: 0 });

const GlobalSearch = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const resultRefs = useRef([]);
  const navigate = useNavigate();
  const normalizedQuery = query.trim();
  const items = useMemo(() => results.groups.flatMap((group) => group.items), [results.groups]);

  useEffect(() => {
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
    resultRefs.current = [];
    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY_RESULTS);
      setError('');
      setStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      setError('');
      try {
        const response = await fetch(`/api/busqueda-global?q=${encodeURIComponent(normalizedQuery)}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw { response: { status: response.status, data } };
        }
        setResults({ groups: Array.isArray(data.groups) ? data.groups : [], total: Number(data.total) || 0 });
        setStatus('ready');
      } catch (requestError) {
        if (requestError?.name === 'AbortError') return;
        setResults(EMPTY_RESULTS);
        setStatus('error');
        setError(getApiErrorMessage(requestError, 'No fue posible completar la búsqueda institucional.'));
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  useEffect(() => {
    if (activeIndex >= 0) resultRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const openResult = (item) => {
    onClose();
    navigate(item.url);
  };

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (!items.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((current) => {
      if (current < 0) return direction > 0 ? 0 : items.length - 1;
      return (current + direction + items.length) % items.length;
    });
  };

  let resultIndex = -1;
  return (
    <div className="notification-composer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="notification-history"
        style={{ width: 'min(720px, 100%)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-title"
        onKeyDown={handleDialogKeyDown}
      >
        <header>
          <div>
            <span className="section-kicker">Acceso rápido</span>
            <h2 id="global-search-title">Buscar en el sistema</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar búsqueda">
            <X size={20} />
          </button>
        </header>

        <label className="notification-directory-search" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', margin: '0 24px' }}>
          <Search size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, caso o registro…"
            autoComplete="off"
            spellCheck="false"
            aria-label="Nombre, caso o registro"
            aria-describedby="global-search-privacy"
          />
          {status === 'loading' && <LoaderCircle className="is-spinning" size={19} aria-label="Buscando" />}
        </label>

        <p className="notification-audience-note" id="global-search-privacy" style={{ display: 'flex', gap: 7, margin: '9px 24px 14px' }}>
          <LockKeyhole size={15} aria-hidden="true" />
          Solo aparecen secciones y registros habilitados por tus permisos.
        </p>

        <div className="notification-history__list" style={{ minHeight: 190, maxHeight: 'min(520px, calc(100dvh - 260px))', overflowY: 'auto', borderRight: 0 }} aria-live="polite" aria-busy={status === 'loading'}>
          {normalizedQuery.length < MIN_QUERY_LENGTH && (
            <div className="notification-history__state">
              <Search size={28} aria-hidden="true" />
              <strong>Escribe al menos 2 caracteres</strong>
              <span>Puedes buscar estudiantes, personas, casos y registros a los que tienes acceso.</span>
            </div>
          )}
          {status === 'loading' && (
            <div className="notification-history__state"><span>Buscando coincidencias autorizadas…</span></div>
          )}
          {status === 'error' && (
            <div className="notification-history__state" role="alert">
              <strong>No pudimos completar la búsqueda</strong>
              <span>{error}</span>
              <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>Limpiar búsqueda</button>
            </div>
          )}
          {status === 'ready' && results.total === 0 && (
            <div className="notification-history__state">
              <strong>No encontramos coincidencias</strong>
              <span>Prueba con otro nombre, código o identificador.</span>
            </div>
          )}
          {status === 'ready' && results.groups.map((group) => (
            <Fragment key={group.key}>
              <h3 className="section-kicker" id={`search-group-${group.key}`} style={{ margin: 0, padding: '16px 20px 6px' }}>
                {group.label} · {group.items.length}
              </h3>
              {group.items.map((item) => {
                  resultIndex += 1;
                  const index = resultIndex;
                  return (
                    <button
                      type="button"
                      key={`${group.key}-${item.id}`}
                      aria-label={[item.title, item.subtitle, item.meta].filter(Boolean).join(' · ')}
                      aria-describedby={`search-group-${group.key}`}
                      ref={(node) => { resultRefs.current[index] = node; }}
                      onClick={() => openResult(item)}
                      style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center' }}
                    >
                      <span style={{ display: 'grid', minWidth: 0, gap: 2 }}>
                        <strong>{item.title}</strong>
                        {item.subtitle && <p>{item.subtitle}</p>}
                        {item.meta && <small>{item.meta}</small>}
                      </span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  );
                })}
            </Fragment>
          ))}
        </div>

        <footer>
          <span><kbd>↑</kbd><kbd>↓</kbd> recorrer</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </footer>
      </section>
    </div>
  );
};

export default GlobalSearch;
