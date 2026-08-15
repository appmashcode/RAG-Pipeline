const { client, EMBED_MODEL } = require('./azure');

/**
 * EMBEDDINGS
 * ----------
 * Har text ko numbers ke ek lambe array (vector) me badalna.
 * `text-embedding-3-small` -> 1536 dimensions.
 *
 * Jo texts meaning me qareeb hote hain, unke vectors bhi space me qareeb hote hain.
 * Isi wajah se hum "semantic search" kar paate hain (keyword match ke baghair).
 */

const BATCH_SIZE = 32; // ek request me itne texts bhejte hain (rate limit safe)

async function embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: batch });
    // API order guarantee nahi karta, isliye index se sort karte hain
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
}

async function embedOne(text) {
  const [vector] = await embedTexts([text]);
  return vector;
}

module.exports = { embedTexts, embedOne, EMBED_MODEL };
