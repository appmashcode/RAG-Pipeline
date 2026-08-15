const OpenAI = require('openai');

/**
 * Ek hi Azure AI Foundry client — chat aur embeddings dono ke liye.
 * Endpoint `.../openai/v1` hai, jo OpenAI SDK ke sath directly compatible hai.
 */
const client = new OpenAI({
  baseURL: process.env.AZURE_INFERENCE_ENDPOINT,
  apiKey: process.env.AZURE_INFERENCE_KEY,
});

const CHAT_MODEL = process.env.AZURE_MODEL_NAME || 'gpt-4o-mini';
const EMBED_MODEL = process.env.AZURE_EMBEDDING_MODEL || 'text-embedding-3-small';

module.exports = { client, CHAT_MODEL, EMBED_MODEL };
