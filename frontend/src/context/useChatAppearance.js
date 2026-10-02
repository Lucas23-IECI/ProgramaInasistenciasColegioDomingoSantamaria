import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getApiErrorMessage } from '../utils/apiError';

export const DEFAULT_CHAT_APPEARANCE = Object.freeze({ fondo: 'institucional', tamano_texto: 'normal', fondo_data: null });
export const safeChatAppearance = (value) => {
  const data = value || {};
  return ({
  fondo: ['institucional', 'salvia', 'arena', 'azul', 'personalizado'].includes(data.fondo) ? data.fondo : 'institucional',
  tamano_texto: data.tamano_texto === 'grande' ? 'grande' : 'normal',
  fondo_data: typeof data.fondo_data === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(data.fondo_data) && data.fondo_data.length < 5_600_000 ? data.fondo_data : null,
  });
};
export default function useChatAppearance(owner, isCurrentSession) {
  const sequence = useRef(0);
  const [state, setState] = useState({ owner, appearance: DEFAULT_CHAT_APPEARANCE, loaded: false, error: '' });
  const reloadAppearance = useCallback(async () => {
    if (!owner) return;
    const version = ++sequence.current;
    try {
      const { data } = await axios.get('/api/chat/apariencia');
      if (version === sequence.current && isCurrentSession()) setState({ owner, appearance: safeChatAppearance(data), loaded: true, error: '' });
    } catch (error) {
      if (version === sequence.current && isCurrentSession()) setState((current) => ({ owner, appearance: current.owner === owner ? current.appearance : DEFAULT_CHAT_APPEARANCE, loaded: false, error: error.response?.status === 404 ? 'Este servidor todavía no permite guardar la apariencia del chat.' : getApiErrorMessage(error, 'No pudimos cargar tu apariencia. Intenta nuevamente.') }));
    }
  }, [owner, isCurrentSession]);
  useEffect(() => { const generation = sequence; reloadAppearance(); return () => { ++generation.current; }; }, [reloadAppearance]);
  const saveAppearance = useCallback(async (appearance) => {
    if (!owner || !isCurrentSession()) return false;
    const version = ++sequence.current;
    const { data } = await axios.patch('/api/chat/apariencia', appearance);
    if (version !== sequence.current || !isCurrentSession()) return false;
    setState({ owner, appearance: safeChatAppearance(data), loaded: true, error: '' });
    return true;
  }, [owner, isCurrentSession]);
  const current = state.owner === owner ? state : { appearance: DEFAULT_CHAT_APPEARANCE, loaded: false, error: '' };
  return { appearance: owner ? current.appearance : DEFAULT_CHAT_APPEARANCE, appearanceLoaded: current.loaded, appearanceError: current.error, reloadAppearance, saveAppearance };
}
