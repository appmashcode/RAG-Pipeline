import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import ChatTab from './components/ChatTab';
import DocumentsTab from './components/DocumentsTab';
import SearchLabTab from './components/SearchLabTab';
import SettingsTab from './components/SettingsTab';
import './App.css';

const TABS = [
  { id: 'chat', label: 'Chat', hint: 'RAG + tool calling' },
  { id: 'documents', label: 'Documents', hint: 'upload, chunking, embeddings' },
  { id: 'search', label: 'Search Lab', hint: 'vector vs keyword vs hybrid' },
  { id: 'settings', label: 'Settings', hint: 'Azure config aur store' },
];

export default function App() {
  const [tab, setTab] = useState('chat');
  const [health, setHealth] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState(null);
  const [connectionError, setConnectionError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([api.health(), api.listDocuments()]);
      setHealth(h);
      setDocuments(d.documents);
      setStats(d.stats);
      setConnectionError('');
    } catch (e) {
      setConnectionError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◆</span>
          <div>
            <h1>DocMind</h1>
            <p>Azure AI Foundry · RAG · Vector Search · Tool Calling</p>
          </div>
        </div>

        <div className="topbar-meta">
          {health && (
            <>
              <span className="pill">{health.chatModel}</span>
              <span className="pill pill-dim">{health.embeddingModel}</span>
            </>
          )}
          {stats && (
            <span className="pill pill-dim">
              {stats.documents} docs · {stats.chunks} chunks
            </span>
          )}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-label">{t.label}</span>
            <span className="tab-hint">{t.hint}</span>
          </button>
        ))}
      </nav>

      {connectionError && (
        <div className="banner banner-error">
          Backend se connection nahi ho raha: {connectionError}
          <br />
          <small>Check karein ke backend http://localhost:5000 par chal raha hai.</small>
        </div>
      )}

      <main className="content">
        {tab === 'chat' && <ChatTab documents={documents} />}
        {tab === 'documents' && <DocumentsTab documents={documents} onChange={refresh} />}
        {tab === 'search' && <SearchLabTab documents={documents} />}
        {tab === 'settings' && <SettingsTab health={health} stats={stats} onChange={refresh} />}
      </main>
    </div>
  );
}
