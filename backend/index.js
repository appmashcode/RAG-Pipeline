require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { CHAT_MODEL, EMBED_MODEL } = require('./lib/azure');
const { extractText, SUPPORTED } = require('./lib/extract');
const { chunkDocument } = require('./lib/chunker');
const { embedTexts } = require('./lib/embeddings');
const store = require('./lib/vectorStore');
const { search } = require('./lib/search');
const { answer } = require('./lib/rag');
const { toolDefinitions } = require('./lib/tools');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ============================================================ health ===== */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    endpoint: process.env.AZURE_INFERENCE_ENDPOINT,
    chatModel: CHAT_MODEL,
    embeddingModel: EMBED_MODEL,
    keyLoaded: Boolean(process.env.AZURE_INFERENCE_KEY),
    store: store.stats(),
    tools: toolDefinitions.map((t) => t.function.name),
  });
});

/* ========================================================= documents ===== */

/**
 * Upload -> extract -> chunk -> embed -> store
 * Yehi poori ingestion pipeline hai.
 */
app.post(
  '/api/documents',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Koi file nahi mili (field name: "file")' });

    const strategy = req.body.strategy === 'fixed' ? 'fixed' : 'semantic';
    const chunkTokens = clamp(Number(req.body.chunkTokens) || 400, 50, 2000);
    const overlapTokens = clamp(Number(req.body.overlapTokens) || 60, 0, Math.floor(chunkTokens / 2));

    const timings = {};
    let t0 = Date.now();

    try {
      // 1) TEXT EXTRACTION
      const { text, pages, meta } = await extractText(req.file.path, req.file.originalname);
      timings.extractMs = Date.now() - t0;

      if (!text || text.trim().length < 10) {
        return res.status(400).json({ error: 'File se text nahi nikla (scanned PDF ho sakti hai).' });
      }

      // 2) CHUNKING
      t0 = Date.now();
      const chunks = chunkDocument(text, { strategy, chunkTokens, overlapTokens, pages });
      timings.chunkMs = Date.now() - t0;

      if (chunks.length === 0) return res.status(400).json({ error: 'Chunking se koi chunk nahi bana.' });

      // 3) EMBEDDINGS
      t0 = Date.now();
      const vectors = await embedTexts(chunks.map((c) => c.text));
      timings.embedMs = Date.now() - t0;

      // 4) STORE
      const docId = crypto.randomUUID();
      const doc = {
        id: docId,
        fileName: req.file.originalname,
        size: req.file.size,
        strategy,
        chunkTokens,
        overlapTokens,
        pageCount: meta.pageCount || null,
        charCount: text.length,
        uploadedAt: new Date().toISOString(),
      };

      store.addDocument(doc);
      store.addChunks(
        chunks.map((c, i) => ({
          id: `${docId}:${i}`,
          docId,
          fileName: doc.fileName,
          index: c.index,
          page: c.page,
          tokens: c.tokens,
          text: c.text,
          embedding: vectors[i],
        }))
      );
      await store.save();

      res.json({
        document: { ...doc, chunkCount: chunks.length },
        pipeline: {
          extractedChars: text.length,
          chunkCount: chunks.length,
          avgChunkTokens: Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / chunks.length),
          embeddingDimensions: vectors[0]?.length || 0,
          embeddingModel: EMBED_MODEL,
          timings,
        },
      });
    } finally {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  })
);

app.get('/api/documents', (req, res) => {
  res.json({ documents: store.listDocuments(), stats: store.stats() });
});

app.get('/api/documents/:id/chunks', (req, res) => {
  const doc = store.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document nahi mila' });

  // embedding vectors bhaari hote hain — sirf preview bhejte hain
  const chunks = store.getChunks(req.params.id).map((c) => ({
    id: c.id,
    index: c.index,
    page: c.page,
    tokens: c.tokens,
    text: c.text,
    embeddingPreview: c.embedding.slice(0, 8),
    embeddingDimensions: c.embedding.length,
  }));

  res.json({ document: doc, chunks });
});

app.delete('/api/documents/:id', (req, res) => {
  const ok = store.deleteDocument(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Document nahi mila' });
  res.json({ deleted: true, stats: store.stats() });
});

app.delete('/api/documents', (req, res) => {
  store.clearAll();
  res.json({ cleared: true, stats: store.stats() });
});

/**
 * Chunking preview — bina embed kiye sirf chunks dikhata hai.
 * Settings ka asar samajhne ke liye (cost bhi zero).
 */
app.post(
  '/api/chunk-preview',
  asyncRoute(async (req, res) => {
    const { text, strategy = 'semantic', chunkTokens = 400, overlapTokens = 60 } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const chunks = chunkDocument(text, {
      strategy,
      chunkTokens: clamp(Number(chunkTokens), 50, 2000),
      overlapTokens: clamp(Number(overlapTokens), 0, 1000),
    });

    res.json({
      strategy,
      chunkCount: chunks.length,
      avgTokens: Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / (chunks.length || 1)),
      chunks,
    });
  })
);

/* ============================================================ search ===== */

/**
 * Search Lab — vector / keyword / hybrid, scores ke sath.
 */
app.post(
  '/api/search',
  asyncRoute(async (req, res) => {
    const { query, mode = 'hybrid', topK = 5, docIds = null } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const result = await search(query, { mode, topK: clamp(Number(topK), 1, 20), docIds });
    res.json(result);
  })
);

/** Teeno modes ek sath — comparison ke liye. */
app.post(
  '/api/search/compare',
  asyncRoute(async (req, res) => {
    const { query, topK = 5, docIds = null } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const k = clamp(Number(topK), 1, 20);
    const [vector, keyword, hybrid] = await Promise.all([
      search(query, { mode: 'vector', topK: k, docIds }),
      search(query, { mode: 'keyword', topK: k, docIds }),
      search(query, { mode: 'hybrid', topK: k, docIds }),
    ]);

    res.json({
      query,
      vector: vector.results,
      keyword: keyword.results,
      hybrid: hybrid.results,
    });
  })
);

/* ============================================================== chat ===== */

/**
 * RAG chat.
 * body: { messages: [{role, content}], agentic, mode, topK, docIds }
 */
app.post(
  '/api/chat',
  asyncRoute(async (req, res) => {
    let { messages, prompt, agentic = true, mode = 'hybrid', topK = 5, docIds = null } = req.body;

    // purane frontend ke liye backward compatible
    if (!messages && prompt) messages = [{ role: 'user', content: prompt }];
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages (ya prompt) required hai' });
    }

    const clean = messages
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .slice(-12); // history limit — token cost control

    const result = await answer(clean, { agentic, mode, topK: clamp(Number(topK), 1, 20), docIds });
    res.json(result);
  })
);

/* =========================================================== errors ====== */

app.use((err, req, res, next) => {
  console.error('Error:', err.status || '', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File 25 MB se bari hai' });
  }
  res.status(err.status || 500).json({
    error: err.message || 'Server error',
    hint: err.status === 401 ? 'Azure key galat ya expire ho gayi hai' : undefined,
  });
});

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n  Backend      http://localhost:${PORT}`);
  console.log(`  Chat model   ${CHAT_MODEL}`);
  console.log(`  Embeddings   ${EMBED_MODEL}`);
  console.log(`  Supported    ${SUPPORTED.join(', ')}`);
  console.log(`  Store        ${JSON.stringify(store.stats())}\n`);
});
