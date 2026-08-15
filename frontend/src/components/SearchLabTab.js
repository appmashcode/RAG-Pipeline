import { useState } from 'react';
import { api } from '../api';

const MODES = [
  { key: 'vector', title: 'Vector (semantic)', desc: 'Matlab ke hisaab se — lafz match hona zaroori nahi' },
  { key: 'keyword', title: 'Keyword (BM25)', desc: 'Lafzon ka match — exact codes/naam ke liye behtar' },
  { key: 'hybrid', title: 'Hybrid (RRF)', desc: 'Dono ke ranks mila kar — aksar sab se behtar' },
];

export default function SearchLabTab({ documents }) {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [docFilter, setDocFilter] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(e) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      setData(await api.compareSearch({ query, topK, docIds: docFilter ? [docFilter] : null }));
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lab">
      <section className="card">
        <h2>Search Lab</h2>
        <p className="card-sub">
          Ek hi query teeno tareeqon se chala kar dekhein ke natije kis tarah badalte hain. Yehi
          samajhne ka sab se tez tareeqa hai ke semantic search karta kya hai.
        </p>

        <form className="lab-form" onSubmit={run}>
          <input
            className="lab-input"
            placeholder='Koi query likhein, jaise "chuttiyon ka qanoon" ya "A-4471"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={docFilter} onChange={(e) => setDocFilter(e.target.value)}>
            <option value="">Sab documents</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName}
              </option>
            ))}
          </select>
          <select value={topK} onChange={(e) => setTopK(Number(e.target.value))}>
            {[3, 5, 8, 10].map((k) => (
              <option key={k} value={k}>
                Top {k}
              </option>
            ))}
          </select>
          <button className="btn" disabled={loading || !query.trim()}>
            {loading ? 'Chal raha hai...' : 'Compare karein'}
          </button>
        </form>

        {documents.length === 0 && (
          <p className="warn">Pehle Documents tab se koi file upload karein.</p>
        )}
        {error && <div className="banner banner-error">{error}</div>}
      </section>

      {data && (
        <div className="lab-columns">
          {MODES.map((m) => (
            <section key={m.key} className="card lab-col">
              <h3>{m.title}</h3>
              <p className="card-sub">{m.desc}</p>

              {data[m.key].length === 0 ? (
                <p className="dim">Koi natija nahi mila.</p>
              ) : (
                data[m.key].map((r, i) => (
                  <div key={r.id} className="result">
                    <div className="result-head">
                      <span className="rank">#{i + 1}</span>
                      <span className="score">{r.score}</span>
                      <span className="dim">
                        {r.fileName}
                        {r.page ? ` · p${r.page}` : ''} · chunk {r.chunkIndex}
                      </span>
                    </div>
                    <ScoreBar value={r.score} max={data[m.key][0].score} />
                    <p className="result-text">{r.text.slice(0, 220)}...</p>
                  </div>
                ))
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ value, max }) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div className="score-bar">
      <div className="score-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
