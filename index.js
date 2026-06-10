/**
 * chromadb-zerodb — Drop-in ChromaDB replacement backed by ZeroDB cloud vectors.
 *
 * No Docker, no setup. Import and go.
 *
 * Usage:
 *   import { Client } from "chromadb-zerodb";
 *   const client = new Client();
 *   const col = await client.createCollection("docs");
 *   await col.add({ documents: ["hello world"], ids: ["id1"] });
 *   const results = await col.query({ queryTexts: ["hi"], nResults: 1 });
 */

const DEFAULT_BASE_URL = "https://api.ainative.studio";
const INSTANT_DB_PATH = "/api/v1/public/instant-db";
const EMBEDDINGS_PATH = "/api/v1/public/embeddings/generate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return "vec_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function request(baseUrl, path, options = {}) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ZeroDB API error ${res.status}: ${body}`);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function authHeaders(apiKey) {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

function vectorsBasePath(projectId) {
  return `/api/v1/public/projects/${projectId}/database/vectors`;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

class Collection {
  /**
   * @param {string} name
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.projectId
   * @param {string} opts.baseUrl
   * @param {object|null} opts.metadata
   */
  constructor(name, { apiKey, projectId, baseUrl, metadata = null }) {
    this.name = name;
    this.metadata = metadata;
    this._apiKey = apiKey;
    this._projectId = projectId;
    this._baseUrl = baseUrl;
  }

  // -- Embed helper --------------------------------------------------------

  async _embed(texts) {
    const data = await request(this._baseUrl, EMBEDDINGS_PATH, {
      method: "POST",
      headers: authHeaders(this._apiKey),
      body: JSON.stringify({ texts, model: "bge-m3" }),
    });
    return data.embeddings;
  }

  // -- Upsert to ZeroDB ----------------------------------------------------

  async _upsertVectors(vectors) {
    const path = `${vectorsBasePath(this._projectId)}/upsert-batch`;
    return request(this._baseUrl, path, {
      method: "POST",
      headers: authHeaders(this._apiKey),
      body: JSON.stringify({ vectors }),
    });
  }

  // -- Public API ----------------------------------------------------------

  /**
   * Add documents (or raw embeddings) to the collection.
   *
   * @param {object} params
   * @param {string[]} [params.ids]          - IDs (auto-generated if omitted)
   * @param {string[]} [params.documents]    - Texts to auto-embed
   * @param {number[][]} [params.embeddings] - Pre-computed vectors
   * @param {object[]} [params.metadatas]    - Metadata per item
   */
  async add({ ids, documents, embeddings, metadatas } = {}) {
    const count = documents?.length || embeddings?.length || 0;
    if (count === 0) throw new Error("Provide documents or embeddings");

    if (!ids) {
      ids = Array.from({ length: count }, () => generateId());
    }

    let vecs = embeddings;
    if (!vecs && documents) {
      vecs = await this._embed(documents);
    }

    const vectors = ids.map((id, i) => ({
      vector_id: id,
      vector_embedding: vecs[i],
      document: documents?.[i] || "",
      metadata: {
        ...(metadatas?.[i] || {}),
        _collection: this.name,
      },
      namespace: this.name,
    }));

    await this._upsertVectors(vectors);
    return { ids };
  }

  /**
   * Upsert documents — same as add but overwrites existing IDs.
   */
  async upsert({ ids, documents, embeddings, metadatas } = {}) {
    return this.add({ ids, documents, embeddings, metadatas });
  }

  /**
   * Update existing documents by ID.
   */
  async update({ ids, documents, embeddings, metadatas } = {}) {
    if (!ids || ids.length === 0) throw new Error("ids required for update");
    return this.add({ ids, documents, embeddings, metadatas });
  }

  /**
   * Query the collection by text or embeddings.
   *
   * @param {object} params
   * @param {string[]} [params.queryTexts]
   * @param {number[][]} [params.queryEmbeddings]
   * @param {number} [params.nResults=10]
   * @param {object} [params.where]           - Metadata filter
   * @returns {{ ids: string[][], documents: string[][], metadatas: object[][], distances: number[][] }}
   */
  async query({ queryTexts, queryEmbeddings, nResults = 10, where } = {}) {
    const queries = queryEmbeddings || (queryTexts ? await this._embed(queryTexts) : null);
    if (!queries || queries.length === 0) throw new Error("Provide queryTexts or queryEmbeddings");

    const allIds = [];
    const allDocs = [];
    const allMetas = [];
    const allDistances = [];

    for (const queryVec of queries) {
      const path = `${vectorsBasePath(this._projectId)}/search`;
      const payload = {
        query_embedding: queryVec,
        limit: nResults,
        namespace: this.name,
      };
      if (where) {
        payload.filter_metadata = where;
      }

      const data = await request(this._baseUrl, path, {
        method: "POST",
        headers: authHeaders(this._apiKey),
        body: JSON.stringify(payload),
      });

      const results = data?.results || data || [];
      const resultArr = Array.isArray(results) ? results : [];

      allIds.push(resultArr.map((r) => r.vector_id || r.id || ""));
      allDocs.push(resultArr.map((r) => r.document || r.content || ""));
      allMetas.push(resultArr.map((r) => r.metadata || {}));
      allDistances.push(resultArr.map((r) => r.distance ?? r.score ?? 0));
    }

    return {
      ids: allIds,
      documents: allDocs,
      metadatas: allMetas,
      distances: allDistances,
    };
  }

  /**
   * Get documents by IDs or metadata filter.
   *
   * @param {object} [params]
   * @param {string[]} [params.ids]
   * @param {object} [params.where]
   * @returns {{ ids: string[], documents: string[], metadatas: object[] }}
   */
  async get({ ids, where } = {}) {
    // ZeroDB doesn't have a direct "get by id" — we search with high limit
    // For ID-based get, we fetch the full namespace and filter client-side.
    const path = `${vectorsBasePath(this._projectId)}`;
    const params = new URLSearchParams({
      namespace: this.name,
      limit: "1000",
    });

    const data = await request(this._baseUrl, `${path}?${params}`, {
      method: "GET",
      headers: authHeaders(this._apiKey),
    });

    let results = data?.vectors || data?.results || data || [];
    if (!Array.isArray(results)) results = [];

    // Filter by IDs if provided
    if (ids && ids.length > 0) {
      const idSet = new Set(ids);
      results = results.filter((r) => idSet.has(r.vector_id || r.id));
    }

    // Filter by metadata if provided
    if (where) {
      results = results.filter((r) => {
        const meta = r.metadata || {};
        return Object.entries(where).every(([k, v]) => meta[k] === v);
      });
    }

    return {
      ids: results.map((r) => r.vector_id || r.id || ""),
      documents: results.map((r) => r.document || r.content || ""),
      metadatas: results.map((r) => r.metadata || {}),
    };
  }

  /**
   * Delete documents by IDs or metadata filter.
   *
   * @param {object} [params]
   * @param {string[]} [params.ids]
   * @param {object} [params.where]
   */
  async delete({ ids, where } = {}) {
    if (!ids && !where) throw new Error("Provide ids or where filter");

    // If we have a where filter but no IDs, resolve IDs first
    let targetIds = ids;
    if (!targetIds && where) {
      const matched = await this.get({ where });
      targetIds = matched.ids;
    }

    if (!targetIds || targetIds.length === 0) return;

    const path = `${vectorsBasePath(this._projectId)}/delete`;
    await request(this._baseUrl, path, {
      method: "POST",
      headers: authHeaders(this._apiKey),
      body: JSON.stringify({
        vector_ids: targetIds,
        namespace: this.name,
      }),
    });
  }

  /**
   * Count documents in this collection.
   * @returns {number}
   */
  async count() {
    const path = `${vectorsBasePath(this._projectId)}`;
    const params = new URLSearchParams({
      namespace: this.name,
      limit: "0",
      count_only: "true",
    });

    try {
      const data = await request(this._baseUrl, `${path}?${params}`, {
        method: "GET",
        headers: authHeaders(this._apiKey),
      });
      return data?.total || data?.count || 0;
    } catch {
      // Fallback: fetch all and count
      const all = await this.get();
      return all.ids.length;
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

class Client {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]     - ZeroDB API key (env: ZERODB_API_KEY)
   * @param {string} [opts.projectId]  - ZeroDB project ID (env: ZERODB_PROJECT_ID)
   * @param {string} [opts.baseUrl]    - API base URL (env: ZERODB_BASE_URL)
   */
  constructor({ apiKey, projectId, baseUrl } = {}) {
    this._apiKey = apiKey || this._env("ZERODB_API_KEY") || null;
    this._projectId = projectId || this._env("ZERODB_PROJECT_ID") || null;
    this._baseUrl = (baseUrl || this._env("ZERODB_BASE_URL") || DEFAULT_BASE_URL).replace(/\/$/, "");
    this._collections = new Map();
    this._provisioned = false;
  }

  _env(name) {
    try {
      return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Auto-provision a ZeroDB project if no API key / project ID provided.
   * Uses the instant-db endpoint for zero-auth setup.
   */
  async _ensureProvisioned() {
    if (this._apiKey && this._projectId) return;
    if (this._provisioned) return;

    const data = await request(this._baseUrl, INSTANT_DB_PATH, {
      method: "POST",
      body: JSON.stringify({ agree_terms: true }),
    });

    this._apiKey = data.api_key;
    this._projectId = data.project_id;
    this._provisioned = true;

    const claimUrl = data.claim_url || `${this._baseUrl}/claim/${data.claim_token}`;

    /* eslint-disable no-console */
    console.log("\n  ╔═══════════════════════════════════════════════════════╗");
    console.log("  ║  ZeroDB project auto-provisioned (free, 72h trial)  ║");
    console.log("  ╠═══════════════════════════════════════════════════════╣");
    console.log(`  ║  Project:  ${this._projectId.slice(0, 36).padEnd(42)}║`);
    console.log(`  ║  API Key:  ${(this._apiKey || "").slice(0, 12)}...${"".padEnd(29)}║`);
    console.log("  ║                                                       ║");
    console.log("  ║  Claim your project to keep it permanently:           ║");
    console.log(`  ║  ${claimUrl.slice(0, 53).padEnd(53)}  ║`);
    console.log("  ╚═══════════════════════════════════════════════════════╝\n");
    /* eslint-enable no-console */
  }

  /**
   * Create a new collection.
   * @param {string} name
   * @param {object} [metadata]
   * @returns {Promise<Collection>}
   */
  async createCollection(name, metadata = null) {
    await this._ensureProvisioned();
    const col = new Collection(name, {
      apiKey: this._apiKey,
      projectId: this._projectId,
      baseUrl: this._baseUrl,
      metadata,
    });
    this._collections.set(name, col);
    return col;
  }

  /**
   * Get an existing collection by name.
   * @param {string} name
   * @returns {Promise<Collection>}
   */
  async getCollection(name) {
    await this._ensureProvisioned();
    if (this._collections.has(name)) return this._collections.get(name);
    const col = new Collection(name, {
      apiKey: this._apiKey,
      projectId: this._projectId,
      baseUrl: this._baseUrl,
    });
    this._collections.set(name, col);
    return col;
  }

  /**
   * Get or create a collection.
   * @param {string} name
   * @param {object} [metadata]
   * @returns {Promise<Collection>}
   */
  async getOrCreateCollection(name, metadata = null) {
    await this._ensureProvisioned();
    if (this._collections.has(name)) return this._collections.get(name);
    return this.createCollection(name, metadata);
  }

  /**
   * List all known collection names.
   * @returns {Promise<string[]>}
   */
  async listCollections() {
    return Array.from(this._collections.keys());
  }

  /**
   * Delete a collection (removes local reference and deletes vectors in namespace).
   * @param {string} name
   */
  async deleteCollection(name) {
    await this._ensureProvisioned();
    const col = this._collections.get(name);
    if (col) {
      try {
        // Delete all vectors in this namespace
        const all = await col.get();
        if (all.ids.length > 0) {
          await col.delete({ ids: all.ids });
        }
      } catch {
        // Best-effort cleanup
      }
    }
    this._collections.delete(name);
  }

  /**
   * Health check / heartbeat.
   * @returns {Promise<number>} nanosecond timestamp
   */
  async heartbeat() {
    try {
      await request(this._baseUrl, "/health", { method: "GET" });
    } catch {
      // Ignore — heartbeat is best-effort
    }
    return Date.now() * 1_000_000; // ms -> ns
  }
}

export { Client, Collection };
export default { Client, Collection };
