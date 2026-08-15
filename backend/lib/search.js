const { cosineSimilarity, allChunks } = require('./vectorStore');
const { embedOne } = require('./embeddings');

/**
 * SEARCH — teen tareeqe, taake farq samajh aaye
 * --------------------------------------------
 *  1. vector  -> sirf meaning ke hisaab se (semantic search)
 *  2. keyword -> BM25, yaani lafzon ka match (classic search engine)
 *  3. hybrid  -> dono ke natije RRF se mila kar (sab se accurate, aksar)
 *
 * Kab kya behtar hai?
 *  - "sales kaise barhayen" jaise sawal -> vector jeetta hai (alfaaz match nahi hote)
 *  - "invoice #A-4471" jaise exact code -> keyword jeetta hai
 *  - real app me hybrid default rakhna chahiye
 */

/* ------------------------------------------------------------- keyword ---- */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'of', 'in',
  'on', 'for', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'as', 'be',
  'ka', 'ki', 'ke', 'hai', 'hain', 'ko', 'se', 'me', 'mein', 'kya', 'aur',
]);

function tokenize(text) {
  return text
    .toLowerCase()
    // hyphen rakhte hain (A-4471 ek hi token rahe) lekin '#' hata dete hain,
    // warna "#a-4471" aur "a-4471" alag tokens ban jate hain aur match nahi hota.
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * BM25 — keyword relevance ka standard formula.
 * Jo lafz poore corpus me kam aata hai lekin is chunk me zyada, wo score barhata hai.
 */
function bm25Search(query, chunks, topK) {
  const k1 = 1.5;
  const b = 0.75;

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const docTokens = chunks.map((c) => tokenize(c.text));
  const docLengths = docTokens.map((t) => t.length);
  const avgLen = docLengths.reduce((s, l) => s + l, 0) / (docLengths.length || 1);

  // har term kitne documents me aata hai
  const df = new Map();
  docTokens.forEach((tokens) => {
    new Set(tokens).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });

  const N = chunks.length;
  const scored = chunks.map((chunk, i) => {
    const tokens = docTokens[i];
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));

    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) || 0;
      if (f === 0) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLengths[i] / avgLen))));
    }
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK);
}

/* -------------------------------------------------------------- vector ---- */

async function vectorSearch(query, chunks, topK) {
  const queryVector = await embedOne(query);
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryVector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/* -------------------------------------------------------------- hybrid ---- */

/**
 * Reciprocal Rank Fusion — dono lists ke *rank* ko mila kar ek final rank.
 * Score scale alag hone se farq nahi padta, isi liye ye robust hai.
 */
function reciprocalRankFusion(lists, topK, k = 60) {
  const scores = new Map();
  const chunkById = new Map();

  lists.forEach((list) => {
    list.forEach((item, rank) => {
      const id = item.chunk.id;
      chunkById.set(id, item.chunk);
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id, score]) => ({ chunk: chunkById.get(id), score }));
}

/* ---------------------------------------------------------------- main ---- */

/**
 * @param {string} query
 * @param {object} opts { mode: 'vector'|'keyword'|'hybrid', topK, docIds, minScore }
 */
async function search(query, { mode = 'hybrid', topK = 5, docIds = null, minScore = 0 } = {}) {
  const chunks = allChunks(docIds);
  if (chunks.length === 0) return { mode, results: [], breakdown: null };

  // hybrid ke liye har list se thoda zyada nikaalte hain, phir fuse karte hain
  const poolSize = Math.max(topK * 4, 20);

  if (mode === 'keyword') {
    const results = bm25Search(query, chunks, topK);
    return { mode, results: format(results), breakdown: null };
  }

  if (mode === 'vector') {
    const results = (await vectorSearch(query, chunks, topK)).filter((r) => r.score >= minScore);
    return { mode, results: format(results), breakdown: null };
  }

  const [vec, kw] = await Promise.all([
    vectorSearch(query, chunks, poolSize),
    Promise.resolve(bm25Search(query, chunks, poolSize)),
  ]);
  const fused = reciprocalRankFusion([vec, kw], topK);

  return {
    mode: 'hybrid',
    results: format(fused),
    // seekhne ke liye: dono lists alag se bhi bhej rahe hain
    breakdown: { vector: format(vec.slice(0, topK)), keyword: format(kw.slice(0, topK)) },
  };
}

function format(items) {
  return items.map(({ chunk, score }) => ({
    id: chunk.id,
    docId: chunk.docId,
    fileName: chunk.fileName,
    page: chunk.page,
    chunkIndex: chunk.index,
    tokens: chunk.tokens,
    text: chunk.text,
    score: Number(score.toFixed(4)),
  }));
}

module.exports = { search, tokenize };
