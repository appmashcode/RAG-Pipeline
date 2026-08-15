const { search } = require('./search');
const { listDocuments } = require('./vectorStore');

/**
 * TOOL CALLING (function calling)
 * -------------------------------
 * Model ko hum tools ki "list" dete hain. Model khud faisla karta hai ke
 * sawal ka jawab dene ke liye kaunsa tool chalana hai aur kya arguments dene hain.
 *
 * Flow:
 *   1. Hum model ko messages + tools bhejte hain
 *   2. Model jawab ke bajaye `tool_calls` return karta hai
 *   3. Hum wo function chalate hain aur natija `role: "tool"` message me wapas bhejte hain
 *   4. Model us natije ko dekh kar final jawab likhta hai
 *
 * Yahan sab se ahem tool `search_knowledge_base` hai — yehi RAG ko
 * "agentic" banata hai: model khud decide karta hai ke documents dekhne hain ya nahi.
 */

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Uploaded documents me semantic search karta hai. Jab bhi user ke sawal ka jawab uske apne documents me ho sakta hai, ye tool zaroor chalao. Ek hi sawal ke liye alag-alag phrasing se ek se zyada baar bhi chala sakte ho.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query. User ke sawal ko aise likho jaise document me likha hoga.',
          },
          top_k: {
            type: 'integer',
            description: 'Kitne chunks laane hain (default 5, max 15).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description:
        'Knowledge base me maujood tamaam documents ki list deta hai (naam, size, chunk count). Jab user pooche ke "tumhare paas kaunsi files hain" to ye chalao.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculator',
      description:
        'Math expression evaluate karta hai. Hisaab-kitaab ke liye khud calculate mat karo, ye tool use karo.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Math expression, jaise "1200 * 0.175" ya "(45+55)/4".',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'current_datetime',
      description: 'Abhi ka date aur time deta hai. "aaj", "kal", "is mahine" jaise sawalon ke liye.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA timezone, default "Asia/Karachi".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Kisi bhi shehar ka mojooda mausam batata hai (live data).',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Shehar ka naam, jaise "Karachi" ya "London".' },
        },
        required: ['city'],
      },
    },
  },
];

/* ------------------------------------------------------------ executors ---- */

async function runSearchKnowledgeBase({ query, top_k }) {
  const topK = Math.min(Math.max(Number(top_k) || 5, 1), 15);
  const { results } = await search(query, { mode: 'hybrid', topK });

  if (results.length === 0) {
    return { found: 0, message: 'Knowledge base me is query se koi matching content nahi mila.', results: [] };
  }

  return {
    found: results.length,
    results: results.map((r) => ({
      source_id: r.id,
      file: r.fileName,
      page: r.page,
      score: r.score,
      content: r.text,
    })),
  };
}

function runListDocuments() {
  const docs = listDocuments();
  if (docs.length === 0) return { count: 0, documents: [], message: 'Abhi koi document upload nahi hua.' };
  return {
    count: docs.length,
    documents: docs.map((d) => ({
      file: d.fileName,
      chunks: d.chunkCount,
      size_kb: Math.round(d.size / 1024),
      strategy: d.strategy,
      uploaded_at: d.uploadedAt,
    })),
  };
}

function runCalculator({ expression }) {
  const expr = String(expression || '').trim();

  // Sirf safe math characters allow karte hain — eval injection se bachne ke liye.
  if (!/^[0-9+\-*/%^().,\s]+$/.test(expr)) {
    return { error: 'Sirf numbers aur + - * / % ^ ( ) allowed hain.' };
  }

  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr.replace(/\^/g, '**')});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { error: 'Expression ka natija valid number nahi hai.' };
    }
    return { expression: expr, result };
  } catch (e) {
    return { error: `Invalid expression: ${e.message}` };
  }
}

function runCurrentDatetime({ timezone } = {}) {
  const tz = timezone || 'Asia/Karachi';
  try {
    return {
      timezone: tz,
      datetime: new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        dateStyle: 'full',
        timeStyle: 'medium',
      }).format(new Date()),
      iso_utc: new Date().toISOString(),
    };
  } catch {
    return { error: `Unknown timezone: ${tz}` };
  }
}

const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow',
  75: 'Heavy snow', 80: 'Rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail',
};

async function runGetWeather({ city }) {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    );
    const geo = await geoRes.json();
    const place = geo.results?.[0];
    if (!place) return { error: `Shehar nahi mila: ${city}` };

    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`
    );
    const w = await wRes.json();
    const c = w.current;

    return {
      city: `${place.name}, ${place.country}`,
      temperature_c: c.temperature_2m,
      humidity_pct: c.relative_humidity_2m,
      wind_kmh: c.wind_speed_10m,
      condition: WEATHER_CODES[c.weather_code] || `code ${c.weather_code}`,
    };
  } catch (e) {
    return { error: `Weather fetch failed: ${e.message}` };
  }
}

const executors = {
  search_knowledge_base: runSearchKnowledgeBase,
  list_documents: runListDocuments,
  calculator: runCalculator,
  current_datetime: runCurrentDatetime,
  get_weather: runGetWeather,
};

/** Ek tool call chalata hai aur uska JSON natija wapas karta hai. */
async function executeTool(name, argsJson) {
  const fn = executors[name];
  if (!fn) return { error: `Unknown tool: ${name}` };

  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: `Tool arguments valid JSON nahi thay: ${argsJson}` };
  }

  return fn(args);
}

module.exports = { toolDefinitions, executeTool };
