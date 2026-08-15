import { useState } from 'react';
import { api } from '../api';

export default function SettingsTab({ health, stats, onChange }) {
  const [clearing, setClearing] = useState(false);

  if (!health) return <div className="card">Backend se maloomat aa rahi hai...</div>;

  async function clearAll() {
    // eslint-disable-next-line no-restricted-globals
    if (!window.confirm('Sab documents aur unke vectors delete ho jayenge. Aage barhein?')) return;
    setClearing(true);
    try {
      await api.clearAll();
      onChange();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Azure AI Foundry connection</h2>
        <dl className="kv">
          <dt>Endpoint</dt>
          <dd className="mono">{health.endpoint}</dd>
          <dt>Chat model</dt>
          <dd className="mono">{health.chatModel}</dd>
          <dt>Embedding model</dt>
          <dd className="mono">{health.embeddingModel}</dd>
          <dt>API key</dt>
          <dd>{health.keyLoaded ? <span className="ok">loaded ✓</span> : <span className="bad">missing ✗</span>}</dd>
        </dl>
        <p className="card-sub">
          Ye values <code>backend/.env</code> se aati hain. Model badalna ho to wahan
          <code> AZURE_MODEL_NAME</code> ya <code>AZURE_EMBEDDING_MODEL</code> edit karein aur backend restart karein.
        </p>
      </section>

      <section className="card">
        <h2>Vector store</h2>
        <div className="stat-row">
          <Stat label="Documents" value={stats?.documents ?? 0} />
          <Stat label="Chunks (vectors)" value={stats?.chunks ?? 0} />
          <Stat label="Dimensions" value={stats?.dimensions ?? 0} />
          <Stat label="Total tokens" value={(stats?.totalTokens ?? 0).toLocaleString()} />
        </div>
        <p className="card-sub">
          Store ek JSON file hai: <code>backend/data/store.json</code>. Production me yahan Azure AI
          Search ya pgvector aata hai — concept bilkul yehi rehta hai.
        </p>
        <button className="btn danger" onClick={clearAll} disabled={clearing || !stats?.documents}>
          {clearing ? 'Delete ho raha hai...' : 'Sab kuch delete karein'}
        </button>
      </section>

      <section className="card">
        <h2>Available tools</h2>
        <p className="card-sub">Model in tools me se khud chunta hai ke kaunsa chalana hai.</p>
        <ul className="tool-list">
          {health.tools.map((t) => (
            <li key={t}>
              <code>{t}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
