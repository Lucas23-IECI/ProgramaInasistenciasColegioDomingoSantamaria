export const getSafeReturnPath = (value, fallback = '/') => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;

  try {
    const parsed = new URL(value, 'http://ldsm.local');
    if (parsed.origin !== 'http://ldsm.local' || parsed.pathname === '/login') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
};

export const buildReturnPath = (location) => getSafeReturnPath(
  `${location?.pathname || '/'}${location?.search || ''}${location?.hash || ''}`,
);
