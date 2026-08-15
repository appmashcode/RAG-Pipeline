const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
  return data;
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request('/health'),

  listDocuments: () => request('/api/documents'),

  uploadDocument: (file, settings) => {
    const form = new FormData();
    form.append('file', file);
    form.append('strategy', settings.strategy);
    form.append('chunkTokens', settings.chunkTokens);
    form.append('overlapTokens', settings.overlapTokens);
    return request('/api/documents', { method: 'POST', body: form });
  },

  getChunks: (docId) => request(`/api/documents/${docId}/chunks`),

  deleteDocument: (docId) => request(`/api/documents/${docId}`, { method: 'DELETE' }),

  clearAll: () => request('/api/documents', { method: 'DELETE' }),

  search: (body) => request('/api/search', json(body)),

  compareSearch: (body) => request('/api/search/compare', json(body)),

  chat: (body) => request('/api/chat', json(body)),
};
