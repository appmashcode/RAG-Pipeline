const { client, CHAT_MODEL } = require('./azure');
const { search } = require('./search');
const { toolDefinitions, executeTool } = require('./tools');

/**
 * RAG + AGENTIC TOOL CALLING
 * --------------------------
 * Do modes hain:
 *
 *  A) classic   -> hamesha pehle search karo, phir jawab likho.
 *                  (simple, predictable, har sawal pe ek search)
 *
 *  B) agentic   -> model ko tools de do, wo khud decide kare ke search kare ya na kare,
 *                  kitni baar kare, aur sath me calculator/weather bhi use kar sake.
 *                  (zyada powerful, RAG + tool calling ka mila-jula roop)
 */

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT_AGENTIC = `Tum ek document assistant ho jo user ki apni uploaded files par based jawab deta hai.

QAWAID:
- Jab bhi sawal user ke documents se mutalliq ho, "search_knowledge_base" tool zaroor chalao. Apni yaadasht se jawab mat do.
- Agar pehli search se tasalli-bakhsh natija na mile, alag alfaaz ke sath dobara search karo.
- Har us jumle ke aakhir me citation lagao jo document se aaya ho, is format me: [S1] ya [S1][S3]
- Citation labels wahi use karo jo tool ke natije me "source_id" me diye gaye hain.
- Agar documents me jawab mojood na ho to saaf keh do ke "ye maloomat aapke documents me nahi mili" — jhoot mat banao.
- Hisaab ke liye calculator tool use karo, apne aap calculate mat karo.
- Jawab usi zabaan me do jis me user ne sawal poocha hai (Urdu/Roman Urdu/English).`;

const SYSTEM_PROMPT_CLASSIC = `Tum ek document assistant ho. Neeche di gayi CONTEXT hi tumhari maloomat ka waahid zariya hai.

QAWAID:
- Sirf CONTEXT me maujood maloomat par jawab do.
- Har jumle ke aakhir me citation lagao: [S1], [S2] waghera — wahi label jo context me diya hai.
- Agar jawab CONTEXT me nahi hai to keh do: "Ye maloomat aapke documents me nahi mili."
- Jawab usi zabaan me do jis me sawal poocha gaya hai.`;

/* ------------------------------------------------------- citation helper ---- */

/**
 * Retrieved chunks ko [S1], [S2] ... labels deta hai (poore turn me stable),
 * taake model bhi wahi label cite kare aur frontend usko chunk se jod sake.
 */
function createCitationRegistry() {
  const byChunkId = new Map();
  const ordered = [];

  return {
    label(chunk) {
      if (byChunkId.has(chunk.id)) return byChunkId.get(chunk.id);
      const label = `S${ordered.length + 1}`;
      byChunkId.set(chunk.id, label);
      ordered.push({ label, ...chunk });
      return label;
    },
    list() {
      return ordered;
    },
  };
}

/* --------------------------------------------------------------- classic ---- */

async function classicRag(messages, { mode = 'hybrid', topK = 5, docIds = null }) {
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const citations = createCitationRegistry();
  const trace = [];

  const { results } = await search(question, { mode, topK, docIds });
  results.forEach((r) => citations.label(r));

  trace.push({
    type: 'retrieval',
    query: question,
    mode,
    resultCount: results.length,
    results: citations.list(),
  });

  const context =
    citations.list().length > 0
      ? citations
          .list()
          .map((r) => `[${r.label}] (file: ${r.fileName}${r.page ? `, page ${r.page}` : ''})\n${r.text}`)
          .join('\n\n---\n\n')
      : '(knowledge base khaali hai — koi document upload nahi hua)';

  const completion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_CLASSIC },
      ...messages.slice(0, -1),
      { role: 'user', content: `CONTEXT:\n${context}\n\nSAWAL: ${question}` },
    ],
    max_completion_tokens: 1200,
  });

  return {
    answer: completion.choices[0].message.content,
    citations: citations.list(),
    trace,
    usage: completion.usage,
    toolCallsUsed: [],
  };
}

/* --------------------------------------------------------------- agentic ---- */

async function agenticRag(messages, { mode = 'hybrid', topK = 5, docIds = null }) {
  const citations = createCitationRegistry();
  const trace = [];
  const toolCallsUsed = [];
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const convo = [{ role: 'system', content: SYSTEM_PROMPT_AGENTIC }, ...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model: CHAT_MODEL,
      messages: convo,
      tools: toolDefinitions,
      tool_choice: 'auto',
      max_completion_tokens: 1200,
    });

    const usage = completion.usage;
    if (usage) {
      totalUsage.prompt_tokens += usage.prompt_tokens || 0;
      totalUsage.completion_tokens += usage.completion_tokens || 0;
      totalUsage.total_tokens += usage.total_tokens || 0;
    }

    const message = completion.choices[0].message;
    convo.push(message);

    const calls = message.tool_calls || [];
    if (calls.length === 0) {
      return {
        answer: message.content,
        citations: citations.list(),
        trace,
        usage: totalUsage,
        toolCallsUsed,
        rounds: round + 1,
      };
    }

    // model ne tools maange hain — sab parallel chala dete hain
    const outputs = await Promise.all(
      calls.map(async (call) => {
        const name = call.function.name;
        const rawArgs = call.function.arguments;
        const startedAt = Date.now();

        let result = await executeTool(name, rawArgs);

        // search ke natije ko citation labels de dete hain
        if (name === 'search_knowledge_base' && Array.isArray(result.results)) {
          result = {
            ...result,
            results: result.results.map((r) => {
              const label = citations.label({
                id: r.source_id,
                fileName: r.file,
                page: r.page,
                text: r.content,
                score: r.score,
              });
              return { ...r, source_id: label };
            }),
          };
        }

        const entry = {
          type: 'tool_call',
          round: round + 1,
          name,
          arguments: safeParse(rawArgs),
          result,
          durationMs: Date.now() - startedAt,
        };
        trace.push(entry);
        toolCallsUsed.push(name);

        return { tool_call_id: call.id, role: 'tool', content: JSON.stringify(result) };
      })
    );

    convo.push(...outputs);
  }

  // tool rounds khatam — model se aakhri baar bina tools ke jawab maangte hain
  const final = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [...convo, { role: 'user', content: 'Ab jo maloomat mil chuki hai usi ki bina par final jawab do.' }],
    max_completion_tokens: 1200,
  });

  return {
    answer: final.choices[0].message.content,
    citations: citations.list(),
    trace,
    usage: totalUsage,
    toolCallsUsed,
    rounds: MAX_TOOL_ROUNDS,
    truncated: true,
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

async function answer(messages, opts = {}) {
  const started = Date.now();
  const result = opts.agentic === false ? await classicRag(messages, opts) : await agenticRag(messages, opts);
  return { ...result, latencyMs: Date.now() - started, model: CHAT_MODEL };
}

module.exports = { answer };
