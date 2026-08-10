import { API_URL } from '../config';

export const resolveApiAssetUrl = (value) => {
  if (!value) return null;
  if (!String(value).startsWith('/api/')) return value;
  const apiBase = String(API_URL || '/api').replace(/\/$/, '');
  if (apiBase === '/api') return value;
  return `${apiBase.replace(/\/api$/, '')}${value}`;
};
