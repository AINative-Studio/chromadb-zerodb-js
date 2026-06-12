# chromadb-zerodb

Drop-in ChromaDB replacement for JavaScript/TypeScript. Backed by ZeroDB cloud vectors.

**No Docker. No setup. No infrastructure.** Just `npm install` and go.

```bash
npm install chromadb-zerodb
```

## Quick Start

```js
import { Client } from "chromadb-zerodb";

const client = new Client();
const collection = await client.createCollection("my_docs");

// Add documents (auto-embedded via ZeroDB)
await collection.add({
  documents: [
    "Python is a great programming language",
    "JavaScript powers the web",
    "Rust is fast and memory-safe",
  ],
  ids: ["doc1", "doc2", "doc3"],
  metadatas: [
    { topic: "python" },
    { topic: "javascript" },
    { topic: "rust" },
  ],
});

// Semantic search
const results = await collection.query({
  queryTexts: ["best language for beginners"],
  nResults: 2,
});

console.log(results.documents); // [["Python is a great...", "JavaScript powers..."]]
console.log(results.distances); // [[0.23, 0.41]]
```

## Why chromadb-zerodb?

| Feature | ChromaDB | chromadb-zerodb |
|---------|----------|-----------------|
| Setup | Docker + server | `npm install` |
| Infrastructure | Self-hosted | Cloud (free tier) |
| Embeddings | Bring your own | Auto-embedded (bge-m3, 1024-dim) |
| Scaling | Manual | Automatic |
| API | ChromaDB API | Same ChromaDB API |

## Configuration

### Zero Config (Auto-Provisioning)

Just create a client with no arguments. A free ZeroDB project is auto-provisioned:

```js
const client = new Client(); // auto-provisions, prints claim URL
```

The project lasts 72 hours. Claim it to keep it permanently (link printed in console).

### With Credentials

```js
const client = new Client({
  apiKey: "zdb_live_...",
  projectId: "your-project-id",
});
```

### Environment Variables

```bash
export ZERODB_API_KEY="zdb_live_..."
export ZERODB_PROJECT_ID="your-project-id"
# Optional:
export ZERODB_BASE_URL="https://api.ainative.studio"
```

## API Reference

### Client

```js
import { Client } from "chromadb-zerodb";

const client = new Client({ apiKey, projectId, baseUrl });

await client.createCollection(name, metadata);     // -> Collection
await client.getCollection(name);                   // -> Collection
await client.getOrCreateCollection(name, metadata); // -> Collection
await client.listCollections();                     // -> string[]
await client.deleteCollection(name);                // -> void
await client.heartbeat();                           // -> number (ns timestamp)
```

### Collection

```js
// Add documents (auto-embedded)
await collection.add({
  documents: ["text1", "text2"],
  ids: ["id1", "id2"],           // optional, auto-generated
  metadatas: [{ key: "val" }],   // optional
});

// Add pre-computed embeddings
await collection.add({
  ids: ["id1"],
  embeddings: [[0.1, 0.2, 0.3, ...]],
  documents: ["original text"],
});

// Semantic search
const results = await collection.query({
  queryTexts: ["search query"],
  nResults: 10,
  where: { topic: "python" },   // optional metadata filter
});
// Returns: { ids: [[...]], documents: [[...]], metadatas: [[...]], distances: [[...]] }

// Get by ID
const docs = await collection.get({ ids: ["id1", "id2"] });
// Returns: { ids: [...], documents: [...], metadatas: [...] }

// Get by metadata filter
const filtered = await collection.get({ where: { topic: "python" } });

// Update
await collection.update({
  ids: ["id1"],
  documents: ["updated text"],
  metadatas: [{ topic: "updated" }],
});

// Upsert (insert or update)
await collection.upsert({
  ids: ["id1"],
  documents: ["new or updated text"],
});

// Delete
await collection.delete({ ids: ["id1", "id2"] });
await collection.delete({ where: { topic: "old" } });

// Count
const count = await collection.count();
```

## Migration from ChromaDB

Change one line:

```diff
- import { ChromaClient } from "chromadb";
+ import { Client } from "chromadb-zerodb";

- const client = new ChromaClient();
+ const client = new Client();
```

Everything else stays the same.

## CommonJS

```js
const { Client } = require("chromadb-zerodb");
```

## Requirements

- Node.js >= 18 (uses native `fetch`)
- No external dependencies

## Links

- [ZeroDB Documentation](https://zerodb.ai)
- [Python version](https://pypi.org/project/chromadb-zerodb/) (`pip install chromadb-zerodb`)
- [GitHub](https://github.com/AINative-Studio/chromadb-zerodb-js)

## License

MIT

---

## Powered by ZeroDB + AINative

This package is part of the [AINative](https://ainative.studio) ecosystem — the AI-native developer platform.

### Why ZeroDB?

| Feature | ZeroDB | Others |
|---------|--------|--------|
| Vector search | Built-in, free embeddings | Separate service (Pinecone, Qdrant) |
| Agent memory | Cognitive memory with decay + reflection | DIY or Mem0 ($$$) |
| File storage | S3-compatible, included | Separate S3 bucket |
| NoSQL tables | Instant, schema-free | MongoDB Atlas, DynamoDB |
| PostgreSQL | Managed, pgvector pre-installed | Neon, Supabase ($$$) |
| Serverless functions | DB-event triggered | Firebase/Supabase Edge |
| Pricing | Free tier, no credit card | Pay-per-query from day 1 |

### Get Started Free

```bash
npx zerodb-cli init    # Auto-configures your IDE
```

Or sign up at **[ainative.studio](https://ainative.studio)** — free tier, no credit card required.

[View all ZeroDB packages →](https://docs.ainative.studio)

---

## Zero-Config Auto-Provisioning

**No account needed to start.** On first run, this package automatically:

1. Provisions a **free ZeroDB instance** (~800ms)
2. Saves credentials locally (`.env`, `.mcp.json`)
3. Prints a **claim link** in your terminal

### The 72-Hour Window

Your auto-provisioned instance is **free for 72 hours**. To keep your data permanently, visit the **claim URL** printed in your terminal.

### For AI Agents

If a coding agent (Claude Code, Cursor, Windsurf) installs this package:
- Auto-provisions without human intervention
- The **claim URL** appears in agent output — visit it to take ownership
- `.claude/CLAUDE.md` instructs agents to surface the claim link to you
- Check `.env` or `~/.ainative/config.json` for your project ID if you miss it
