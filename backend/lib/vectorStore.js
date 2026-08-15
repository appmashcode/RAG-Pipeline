const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * VECTOR DATABASE (simple, file-based)
 * ------------------------------------
 * Yahan hum jaan-boojh kar koi managed service use nahi kar rahe, taake aap
 * dekh sakein ke ek vector DB andar se karta kya hai:
 *
 *   - har chunk ka text + uska embedding vector store karna
 *   - metadata (file name, page, chunk index) rakhna
 *   - query aane pe cosine similarity se sabse qareeb vectors dhoondna
 *
 * Production me yehi kaam Azure AI Search / pgvector / Pinecone karte hain,
 * bas woh millions vectors pe fast hote hain (ANN index ki wajah se).
 */

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

let store = { documents: [], chunks: [] };

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store.documents ||= [];
      store.chunks ||= [];
    } catch {
      store = { documents: [], chunks: [] };
    }
  }
}

let saveQueue = Promise.resolve();
function save() {
  // writes ko serialize karte hain taake concurrent uploads file corrupt na karein
  saveQueue = saveQueue.then(() =>
    fsp.writeFile(STORE_FILE, JSON.stringify(store), 'utf8').catch((e) => console.error('store save failed:', e.message))
  );
  return saveQueue;
}

/* ---------------------------------------------------------------- math ---- */

/**
 * Cosine similarity = do vectors ke beech angle ka cosine.
 *   1  -> bilkul same direction (matlab bohot milta-julta)
 *   0  -> koi taalluq nahi
 *  -1  -> ulta
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/* --------------------------------------------------------------- store ---- */

function addDocument(doc) {
  store.documents.push(doc);
}

function addChunks(chunks) {
  store.chunks.push(...chunks);
}

function listDocuments() {
  return store.documents.map((d) => ({
    ...d,
    chunkCount: store.chunks.filter((c) => c.docId === d.id).length,
  }));
}

function getDocument(docId) {
  return store.documents.find((d) => d.id === docId) || null;
}

function getChunks(docId) {
  return store.chunks.filter((c) => c.docId === docId);
}

function allChunks(docIds = null) {
  if (!docIds || docIds.length === 0) return store.chunks;
  const set = new Set(docIds);
  return store.chunks.filter((c) => set.has(c.docId));
}

function deleteDocument(docId) {
  const before = store.documents.length;
  store.documents = store.documents.filter((d) => d.id !== docId);
  store.chunks = store.chunks.filter((c) => c.docId !== docId);
  save();
  return store.documents.length < before;
}

function clearAll() {
  store = { documents: [], chunks: [] };
  save();
}

function stats() {
  const dims = store.chunks[0]?.embedding?.length || 0;
  return {
    documents: store.documents.length,
    chunks: store.chunks.length,
    dimensions: dims,
    totalTokens: store.chunks.reduce((s, c) => s + (c.tokens || 0), 0),
  };
}

load();

module.exports = {
  cosineSimilarity,
  addDocument,
  addChunks,
  listDocuments,
  getDocument,
  getChunks,
  allChunks,
  deleteDocument,
  clearAll,
  stats,
  save,
};
