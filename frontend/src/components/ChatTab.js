import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import AnswerText from './AnswerText';

const EXAMPLES = [
  'Annual leaves kitni milti hain aur kitni carry forward ho sakti hain?',
  'Imported item ka reorder point nikaalo agar daily sales 40 units hain',
  'Invoice #A-4471 ka kya masla hai?',
  'Karachi ka mausam kaisa hai?',
];

export default function ChatTab({ documents }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agentic, setAgentic] = useState(true);
  const [mode, setMode] = useState('hybrid');
  const [topK, setTopK] = useState(5);
  const [docFilter, setDocFilter] = useState('');
  const [openSource, setOpenSource] = useState(null);

  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text) {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    const nextMessages = [...messages, { role: 'user', content: question }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const result = await api.chat({
        // API ko sirf role/content chahiye — baaki meta local hai
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        agentic,
        mode,
        topK,
        docIds: docFilter ? [docFilter] : null,
      });

      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: result.answer,
          citations: result.citations,
          trace: result.trace,
          usage: result.usage,
          latencyMs: result.latencyMs,
          toolCallsUsed: result.toolCallsUsed,
          model: result.model,
        },
      ]);
    } catch (e) {
      setError(e.message);
      setMessages(nextMessages);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-layout">
      <section className="chat-main">
        <div className="chat-scroll">
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>Apne documents se sawal poochein</h2>
              <p>
                Model khud faisla karta hai ke documents me search karna hai, calculator chalana hai,
                ya mausam dekhna hai — har qadam neeche trace me nazar aata hai.
              </p>
              {documents.length === 0 && (
                <p className="warn">
                  Abhi koi document upload nahi hua. <b>Documents</b> tab se file upload karein.
                </p>
              )}
              <div className="examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="example" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="msg msg-user">
                <div className="bubble bubble-user">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="msg msg-assistant">
                <div className="bubble bubble-assistant">
                  <AnswerText text={m.content} citations={m.citations} onCitationClick={setOpenSource} />

                  <MessageFooter message={m} onCitationClick={setOpenSource} />
                </div>
              </div>
            )
          )}

          {loading && (
            <div className="msg msg-assistant">
              <div className="bubble bubble-assistant thinking">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="thinking-label">soch raha hoon — search / tools chal rahe hain</span>
              </div>
            </div>
          )}

          {error && <div className="banner banner-error">{error}</div>}
          <div ref={bottomRef} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            placeholder="Sawal likhein... (Enter = bhejo, Shift+Enter = nayi line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-actions">
            <button type="button" className="btn-ghost" onClick={() => setMessages([])} disabled={!messages.length}>
              Clear chat
            </button>
            <button type="submit" className="btn" disabled={loading || !input.trim()}>
              {loading ? 'Ruko...' : 'Bhejo'}
            </button>
          </div>
        </form>
      </section>

      <aside className="chat-side">
        <h3>Retrieval settings</h3>

        <label className="toggle">
          <input type="checkbox" checked={agentic} onChange={(e) => setAgentic(e.target.checked)} />
          <span>
            <b>Agentic mode</b>
            <small>{agentic ? 'Model khud decide karta hai (tool calling)' : 'Har sawal pe ek fixed search'}</small>
          </span>
        </label>

        <label className="field">
          <span>Search mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="hybrid">Hybrid (vector + keyword)</option>
            <option value="vector">Vector only (semantic)</option>
            <option value="keyword">Keyword only (BM25)</option>
          </select>
        </label>

        <label className="field">
          <span>Top K chunks: {topK}</span>
          <input type="range" min="1" max="15" value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
        </label>

        <label className="field">
          <span>Document filter</span>
          <select value={docFilter} onChange={(e) => setDocFilter(e.target.value)}>
            <option value="">Sab documents</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fileName}
              </option>
            ))}
          </select>
        </label>

        <div className="side-note">
          <b>Tip:</b> Agentic off karke bhi try karein — farq dekhne ko milega ke model khud search
          decide kare ya hum har baar zabardasti search karein.
        </div>
      </aside>

      {openSource && <SourceModal source={openSource} onClose={() => setOpenSource(null)} />}
    </div>
  );
}

function MessageFooter({ message, onCitationClick }) {
  const [openTrace, setOpenTrace] = useState(false);
  const [openSources, setOpenSources] = useState(false);

  const tools = message.toolCallsUsed || [];
  const citations = message.citations || [];

  return (
    <div className="msg-footer">
      <div className="meta-row">
        {tools.length > 0 && (
          <span className="meta-chip">
            {tools.length} tool call{tools.length > 1 ? 's' : ''}: {[...new Set(tools)].join(', ')}
          </span>
        )}
        {message.usage?.total_tokens ? <span className="meta-chip">{message.usage.total_tokens} tokens</span> : null}
        {message.latencyMs ? <span className="meta-chip">{(message.latencyMs / 1000).toFixed(1)}s</span> : null}
      </div>

      <div className="meta-row">
        {citations.length > 0 && (
          <button className="link-btn" onClick={() => setOpenSources((v) => !v)}>
            {openSources ? 'Sources chhupao' : `Sources dekho (${citations.length})`}
          </button>
        )}
        {message.trace?.length > 0 && (
          <button className="link-btn" onClick={() => setOpenTrace((v) => !v)}>
            {openTrace ? 'Pipeline chhupao' : 'Pipeline trace dekho'}
          </button>
        )}
      </div>

      {openSources && (
        <div className="sources">
          {citations.map((c) => (
            <button key={c.label} className="source-card" onClick={() => onCitationClick(c)}>
              <div className="source-head">
                <span className="cite-chip">{c.label}</span>
                <span className="source-file">
                  {c.fileName}
                  {c.page ? ` · page ${c.page}` : ''}
                </span>
                <span className="source-score">score {c.score}</span>
              </div>
              <p>{c.text.slice(0, 160)}...</p>
            </button>
          ))}
        </div>
      )}

      {openTrace && (
        <div className="trace">
          {message.trace.map((step, i) => (
            <div key={i} className="trace-step">
              <div className="trace-head">
                <span className="trace-badge">{step.type === 'tool_call' ? `Round ${step.round}` : 'Retrieval'}</span>
                <b>{step.name || step.mode}</b>
                {step.durationMs != null && <span className="trace-time">{step.durationMs}ms</span>}
              </div>
              <pre className="trace-body">
                {JSON.stringify(step.arguments ?? { query: step.query, mode: step.mode }, null, 2)}
              </pre>
              <pre className="trace-body trace-result">{summarizeResult(step)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeResult(step) {
  const result = step.result ?? { resultCount: step.resultCount };
  if (result?.results && Array.isArray(result.results)) {
    return result.results
      .map((r) => `${r.source_id || r.label}  score=${r.score}  ${r.file || r.fileName}\n   ${(r.content || r.text || '').slice(0, 120)}...`)
      .join('\n');
  }
  return JSON.stringify(result, null, 2);
}

function SourceModal({ source, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="cite-chip">{source.label}</span>
            <b>{source.fileName}</b>
            {source.page && <span className="dim"> · page {source.page}</span>}
          </div>
          <button className="btn-ghost" onClick={onClose}>
            Band karein
          </button>
        </div>
        <div className="modal-meta">
          similarity score: <b>{source.score}</b>
        </div>
        <pre className="modal-body">{source.text}</pre>
      </div>
    </div>
  );
}
