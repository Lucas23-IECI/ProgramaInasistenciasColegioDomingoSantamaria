// En desarrollo: http://localhost:5000/api
// En producción (Docker): /api  → nginx lo proxea al backend
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api';
