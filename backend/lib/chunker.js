/**
 * CHUNKING
 * --------
 * RAG ka pehla core concept. Poori document LLM ko nahi bhej sakte, isliye
 * usko chhote "chunks" me todte hain. Do strategies yahan implement hain:
 *
 *  1. fixed     -> har chunk approx N tokens ka, overlap ke sath
 *  2. semantic  -> pehle paragraph/heading pe todte hain, phir bade paragraphs
 *                  ko fixed strategy se aage todte hain (structure preserve hota hai)
 *
 * Overlap kyun? Taake ek sentence chunk boundary pe kate to context na toote.
 */

// Mota-moti approximation: 1 token ≈ 4 characters (English).
const CHARS_PER_TOKEN = 4;

function tokensToChars(tokens) {
  return Math.max(1, Math.round(tokens * CHARS_PER_TOKEN));
}

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function normalize(text) {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

/** Text ko sentences me todta hai (chunk boundary sentence pe rakhne ke liye). */
function splitSentences(text) {
  const parts = text.match(/[^.!?\n]+[.!?]*[\n]*/g);
  return parts ? parts.map((s) => s).filter((s) => s.trim().length > 0) : [text];
}

/**
 * Fixed-size chunking with overlap.
 * Sentences ko jodte jaate hain jab tak chunk target size tak na pahunch jaye.
 */
function chunkFixed(text, { chunkTokens = 400, overlapTokens = 60 } = {}) {
  const maxChars = tokensToChars(chunkTokens);
  const overlapChars = tokensToChars(overlapTokens);
  const sentences = splitSentences(normalize(text));

  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
  };

  for (const sentence of sentences) {
    // Agar akela sentence hi maxChars se bada hai to usko hard-split karte hain.
    if (sentence.length > maxChars) {
      pushCurrent();
      current = '';
      for (let i = 0; i < sentence.length; i += maxChars - overlapChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }

    if ((current + sentence).length > maxChars && current.length > 0) {
      pushCurrent();
      // overlap: pichle chunk ka aakhri hissa naye chunk ke shuru me daal dete hain
      const tail = current.slice(-overlapChars);
      current = overlapChars > 0 ? tail + sentence : sentence;
    } else {
      current += sentence;
    }
  }
  pushCurrent();

  return chunks.filter((c) => c.length > 0);
}

/**
 * Semantic (structure-aware) chunking.
 * Pehle blank line / markdown heading pe todte hain, phir jo block abhi bhi
 * bada hai usko fixed strategy se todte hain.
 */
function chunkSemantic(text, { chunkTokens = 400, overlapTokens = 60 } = {}) {
  const maxChars = tokensToChars(chunkTokens);
  const clean = normalize(text);

  // blank line ya markdown heading pe split
  const blocks = clean
    .split(/\n\s*\n|\n(?=#{1,6}\s)/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for (const block of blocks) {
    if (block.length > maxChars) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      chunks.push(...chunkFixed(block, { chunkTokens, overlapTokens }));
      continue;
    }

    // chhote blocks ko jodte hain jab tak size allow kare
    if ((current + '\n\n' + block).length > maxChars && current.trim()) {
      chunks.push(current.trim());
      current = block;
    } else {
      current = current ? current + '\n\n' + block : block;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Main entry point.
 * @returns {Array<{text, index, tokens, page}>}
 */
function chunkDocument(text, { strategy = 'semantic', chunkTokens = 400, overlapTokens = 60, pages = null } = {}) {
  const run = strategy === 'fixed' ? chunkFixed : chunkSemantic;

  // Agar page-wise text mila hai (PDF), to har page ko alag chunk karte hain
  // taake citation me page number bata sakein.
  if (Array.isArray(pages) && pages.length > 0) {
    const out = [];
    pages.forEach((pageText, pageIdx) => {
      if (!pageText || !pageText.trim()) return;
      run(pageText, { chunkTokens, overlapTokens }).forEach((chunkText) => {
        out.push({ text: chunkText, index: out.length, tokens: estimateTokens(chunkText), page: pageIdx + 1 });
      });
    });
    return out;
  }

  return run(text, { chunkTokens, overlapTokens }).map((chunkText, i) => ({
    text: chunkText,
    index: i,
    tokens: estimateTokens(chunkText),
    page: null,
  }));
}

module.exports = { chunkDocument, chunkFixed, chunkSemantic, estimateTokens };
