# DocMind — RAG playground on Azure AI Foundry

Apne documents se baat karne wali app. Isko is tarah banaya gaya hai ke RAG ke saare
core concepts **nazar aayein**, chhupe na rahen:

- **Chunking** — dono strategies, settings aap khud badal sakte hain
- **Embeddings** — har chunk ka 1536-dimension vector, UI me preview
- **Vector database** — cosine similarity apne haath se, koi black box nahi
- **Semantic search** — vector vs keyword vs hybrid, scores ke sath side-by-side
- **RAG** — retrieved chunks se jawab, har jumle pe citation
- **Tool calling** — model khud decide karta hai kaunsa tool chalana hai

---

## Chalane ka tareeqa

```bash
npm run install:all   # sirf pehli baar
npm run dev           # backend + frontend dono
```

- Frontend → http://localhost:3000
- Backend → http://localhost:5000

Sirf ek chalana ho to: `npm run backend` ya `npm run frontend`.

Test karne ke liye `sample-docs/corestock-policy.md` upload karein.

---

## Azure AI Foundry settings

Saari config `backend/.env` me hai (template: `backend/.env.example`):

```
AZURE_INFERENCE_ENDPOINT=https://<resource>.services.ai.azure.com/openai/v1
AZURE_INFERENCE_KEY=<api-key>
AZURE_MODEL_NAME=model-router
AZURE_EMBEDDING_MODEL=text-embedding-3-small
PORT=5000
```

### Ye values Foundry me kahan milti hain

1. [ai.azure.com](https://ai.azure.com) par apna project kholein
2. Baayen menu me **Overview** → wahan **Azure AI Foundry project endpoint** aur **API key** milte hain
   - Endpoint ke aakhir me `/openai/v1` lagana zaroori hai
3. Baayen menu me **Deployments** → **Deploy model** → do models deploy karein:
   - **Chat model** — `model-router` (ya `gpt-4o-mini` / `gpt-5-mini`)
   - **Embedding model** — `text-embedding-3-small`
4. Deployment ka **naam** wahi likhein jo `.env` me hai (naam alag ho to `.env` update karein)

> `model-router` khud sawal ki mushkil ke hisaab se model chunta hai — sasta bhi rehta hai
> aur mushkil sawalon pe bada model use karta hai.

### Model badalna ho to

`.env` me `AZURE_MODEL_NAME` badlein aur backend restart karein. `Settings` tab me
mojooda config hamesha dikhti rehti hai.

### Cost ka khayal

- Embeddings sirf **upload ke waqt** ek dafa banti hain (bohot sasti)
- Har chat message pe chat model ka kharcha hota hai
- Settings tab me total chunks/tokens nazar aate hain
- Azure Portal → **Cost Management** me $200 credit track karein

---

## Architecture

```
frontend (React :3000)
   └── fetch → backend (Express :5000)
                  ├── lib/extract.js      PDF/DOCX/TXT/MD se text
                  ├── lib/chunker.js      fixed + semantic chunking
                  ├── lib/embeddings.js   Azure embeddings (batched)
                  ├── lib/vectorStore.js  vectors + cosine similarity
                  ├── lib/search.js       vector / BM25 / hybrid (RRF)
                  ├── lib/tools.js        5 tools for function calling
                  └── lib/rag.js          agentic loop + citations
                        └── Azure AI Foundry
```

Vector store ek JSON file hai: `backend/data/store.json`. Production me yahan
Azure AI Search ya pgvector aayega — **concept bilkul wahi rehta hai**.

---

## App ke chaar tabs

| Tab | Kya seekhne ko milta hai |
|---|---|
| **Chat** | RAG ka poora jawab + citations + har tool call ka trace |
| **Documents** | Upload karte waqt extraction → chunking → embedding ka timing aur nateeja |
| **Search Lab** | Ek query, teeno search modes ka natija side-by-side |
| **Settings** | Azure config, vector store stats, available tools |

### Seekhne ke liye ye zaroor try karein

1. **Search Lab** me `A-4471` search karein → keyword jeetega, vector kamzor rahega
2. Phir `chuttiyon ka qanoon` search karein → vector jeetega (lafz match hi nahi hote)
3. **Documents** tab me chunk size 100 aur 800 dono se upload kar ke farq dekhein
4. **Chat** me *Agentic mode* off/on kar ke dekhein ke tool calling se kya farq padta hai
5. Aisa sawal poochein jo documents me na ho → app saaf keh degi ke maloomat nahi mili

---

## API

| Method | Route | Kaam |
|---|---|---|
| GET | `/health` | config + store stats |
| POST | `/api/documents` | upload → chunk → embed → index |
| GET | `/api/documents` | list |
| GET | `/api/documents/:id/chunks` | chunks + vector preview |
| DELETE | `/api/documents/:id` | ek document delete |
| POST | `/api/chunk-preview` | bina embed kiye chunking preview |
| POST | `/api/search` | ek mode se search |
| POST | `/api/search/compare` | teeno modes ek sath |
| POST | `/api/chat` | RAG chat (agentic ya classic) |

## Tools jo model ko diye gaye hain

| Tool | Kaam |
|---|---|
| `search_knowledge_base` | documents me hybrid semantic search |
| `list_documents` | knowledge base me kaunsi files hain |
| `calculator` | hisaab (model khud calculate na kare) |
| `current_datetime` | aaj ki tareekh/waqt |
| `get_weather` | live mausam (open-meteo, free) |
