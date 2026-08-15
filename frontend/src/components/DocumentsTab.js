import { useState } from 'react';
import { api } from '../api';

export default function DocumentsTab({ documents, onChange }) {
  const [file, setFile] = useState(null);
  const [strategy, setStrategy] = useState('semantic');
  const [chunkTokens, setChunkTokens] = useState(400);
  const [overlapTokens, setOverlapTokens] = useState(60);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [inspecting, setInspecting] = useState(null);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    try {
      const data = await api.uploadDocument(file, { strategy, chunkTokens, overlapTokens });
      setResult(data);
      setFile(null);
      e.target.reset();
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id) {
    await api.deleteDocument(id);
    if (inspecting?.document.id === id) setInspecting(null);
    onChange();
  }

  async function inspect(id) {
    setInspecting(await api.getChunks(id));
  }

  return (
    <div className="docs-layout">
      <section className="card">
        <h2>1 · Document upload karein</h2>
        <p className="card-sub">
          Yahan poori ingestion pipeline chalti hai: <b>text extraction → chunking → embeddings → vector store</b>
        </p>

        <form onSubmit={handleUpload} className="upload-form">
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files[0])} />

          <div className="grid-2">
            <label className="field">
              <span>Chunking strategy</span>
              <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                <option value="semantic">Semantic (heading/paragraph par tode)</option>
                <option value="fixed">Fixed size (sirf token count par tode)</option>
              </select>
            </label>

            <label className="field">
              <span>Chunk size: {chunkTokens} tokens</span>
              <input
                type="range"
                min="100"
                max="1000"
                step="50"
                value={chunkTokens}
                onChange={(e) => setChunkTokens(Number(e.target.value))}
              />
            </label>

            <label className="field">
              <span>Overlap: {overlapTokens} tokens</span>
              <input
                type="range"
                min="0"
                max="200"
                step="10"
                value={overlapTokens}
                onChange={(e) => setOverlapTokens(Number(e.target.value))}
              />
            </label>
          </div>

          <button className="btn" type="submit" disabled={!file || uploading}>
            {uploading ? 'Process ho rahi hai...' : 'Upload aur index karein'}
          </button>
        </form>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="pipeline">
            <h3>Pipeline result</h3>
            <div className="pipeline-steps">
              <PipelineStep
                n="1"
                title="Text extraction"
                value={`${result.pipeline.extractedChars.toLocaleString()} chars`}
                time={result.pipeline.timings.extractMs}
              />
              <PipelineStep
                n="2"
                title="Chunking"
                value={`${result.pipeline.chunkCount} chunks · avg ${result.pipeline.avgChunkTokens} tokens`}
                time={result.pipeline.timings.chunkMs}
              />
              <PipelineStep
                n="3"
                title="Embeddings"
                value={`${result.pipeline.chunkCount} × ${result.pipeline.embeddingDimensions}-dim vectors`}
                time={result.pipeline.timings.embedMs}
              />
              <PipelineStep n="4" title="Vector store" value="indexed aur search ke liye ready" />
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>2 · Knowledge base</h2>
        {documents.length === 0 ? (
          <p className="dim">Abhi koi document nahi hai.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Chunks</th>
                <th>Strategy</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.fileName}</td>
                  <td>{d.chunkCount}</td>
                  <td className="dim">
                    {d.strategy} · {d.chunkTokens}/{d.overlapTokens}
                  </td>
                  <td className="dim">{Math.round(d.size / 1024)} KB</td>
                  <td className="row-actions">
                    <button className="link-btn" onClick={() => inspect(d.id)}>
                      Chunks dekho
                    </button>
                    <button className="link-btn danger" onClick={() => handleDelete(d.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {inspecting && (
        <section className="card">
          <div className="card-head">
            <h2>3 · Chunks — {inspecting.document.fileName}</h2>
            <button className="btn-ghost" onClick={() => setInspecting(null)}>
              Band karein
            </button>
          </div>
          <p className="card-sub">
            Har chunk ka apna {inspecting.chunks[0]?.embeddingDimensions}-dimension vector hai. Neeche
            us vector ke pehle 8 numbers dikh rahe hain — asal me poore {inspecting.chunks[0]?.embeddingDimensions} numbers hote hain.
          </p>

          <div className="chunk-list">
            {inspecting.chunks.map((c) => (
              <div key={c.id} className="chunk">
                <div className="chunk-head">
                  <b>Chunk #{c.index}</b>
                  {c.page && <span className="dim">page {c.page}</span>}
                  <span className="dim">{c.tokens} tokens</span>
                </div>
                <p className="chunk-text">{c.text}</p>
                <code className="vector-preview">
                  [{c.embeddingPreview.map((v) => v.toFixed(4)).join(', ')}, ... ]
                </code>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PipelineStep({ n, title, value, time }) {
  return (
    <div className="pipeline-step">
      <span className="pipeline-n">{n}</span>
      <div>
        <b>{title}</b>
        <p>{value}</p>
        {time != null && <small>{time} ms</small>}
      </div>
    </div>
  );
}
