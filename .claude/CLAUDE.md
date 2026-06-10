# chromadb-zerodb (JavaScript)

Drop-in ChromaDB replacement backed by ZeroDB cloud vectors.

## Package Info
- **npm:** `chromadb-zerodb`
- **Entry:** `index.js` (ESM), `index.cjs` (CommonJS)
- **Zero dependencies** — uses native `fetch`
- **Node >= 18 required**

## Architecture
- `Client` class handles auto-provisioning via `/api/v1/public/instant-db`
- `Collection` class maps ChromaDB operations to ZeroDB REST API
- Embeddings auto-generated via `/api/v1/public/embeddings/generate` (bge-m3, 1024-dim)
- Vectors stored in ZeroDB via `/api/v1/public/projects/{id}/database/vectors/*`

## Key API Mapping
| ChromaDB Method | ZeroDB Endpoint |
|-----------------|-----------------|
| `collection.add()` | `POST /vectors/upsert-batch` |
| `collection.query()` | `POST /vectors/search` |
| `collection.get()` | `GET /vectors?namespace=` |
| `collection.delete()` | `POST /vectors/delete` |

## Testing
```bash
npm test  # uses node:test, no external test runner
```

## Publishing
```bash
npm publish --access public
```
