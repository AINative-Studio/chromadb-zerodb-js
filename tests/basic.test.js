import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client, Collection } from "../index.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

let fetchCalls = [];
let fetchResponses = [];

function pushResponse(status, body) {
  fetchResponses.push({ status, body });
}

function mockFetch(url, opts) {
  const resp = fetchResponses.shift() || { status: 200, body: {} };
  fetchCalls.push({ url, opts });
  return Promise.resolve({
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    text: () => Promise.resolve(typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body)),
    json: () => Promise.resolve(resp.body),
  });
}

// Replace global fetch
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch;

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
});

// ---------------------------------------------------------------------------
// Client tests
// ---------------------------------------------------------------------------

describe("Client", () => {
  it("should create a Client with explicit config", () => {
    const client = new Client({
      apiKey: "zdb_test_key",
      projectId: "proj-123",
      baseUrl: "https://test.example.com",
    });
    assert.ok(client);
    assert.equal(client._apiKey, "zdb_test_key");
    assert.equal(client._projectId, "proj-123");
    assert.equal(client._baseUrl, "https://test.example.com");
  });

  it("should strip trailing slash from baseUrl", () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://a.com/" });
    assert.equal(client._baseUrl, "https://a.com");
  });

  it("should default to api.ainative.studio", () => {
    const client = new Client({ apiKey: "k", projectId: "p" });
    assert.equal(client._baseUrl, "https://api.ainative.studio");
  });

  it("should auto-provision when no credentials", async () => {
    pushResponse(200, {
      api_key: "zdb_temp_abc",
      project_id: "proj-auto-456",
      claim_token: "tok_xyz",
    });

    const client = new Client({ baseUrl: "https://mock.test" });
    const col = await client.createCollection("test_col");

    assert.equal(client._apiKey, "zdb_temp_abc");
    assert.equal(client._projectId, "proj-auto-456");
    assert.ok(col instanceof Collection);
  });

  it("should not auto-provision when credentials are set", async () => {
    const client = new Client({
      apiKey: "zdb_existing",
      projectId: "proj-existing",
      baseUrl: "https://mock.test",
    });
    await client.createCollection("test");
    // No fetch calls should be made for provisioning
    assert.equal(fetchCalls.length, 0);
  });

  it("should return collection from createCollection", async () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    const col = await client.createCollection("my_col");
    assert.equal(col.name, "my_col");
    assert.ok(col instanceof Collection);
  });

  it("should return same collection from getCollection after create", async () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    await client.createCollection("col1");
    const col = await client.getCollection("col1");
    assert.equal(col.name, "col1");
  });

  it("should create new collection on getCollection if not exists", async () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    const col = await client.getCollection("unknown_col");
    assert.equal(col.name, "unknown_col");
  });

  it("should getOrCreateCollection return existing", async () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    const col1 = await client.createCollection("x");
    const col2 = await client.getOrCreateCollection("x");
    assert.strictEqual(col1, col2);
  });

  it("should listCollections return names", async () => {
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    await client.createCollection("a");
    await client.createCollection("b");
    const names = await client.listCollections();
    assert.deepEqual(names, ["a", "b"]);
  });

  it("should deleteCollection remove from list", async () => {
    // get() call returns empty
    pushResponse(200, { vectors: [] });

    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    await client.createCollection("del_me");
    await client.deleteCollection("del_me");
    const names = await client.listCollections();
    assert.deepEqual(names, []);
  });

  it("should heartbeat return nanosecond timestamp", async () => {
    pushResponse(200, { status: "ok" });
    const client = new Client({ apiKey: "k", projectId: "p", baseUrl: "https://t.test" });
    const ts = await client.heartbeat();
    assert.ok(ts > 1_000_000_000_000_000); // nanoseconds
  });
});

// ---------------------------------------------------------------------------
// Collection tests
// ---------------------------------------------------------------------------

describe("Collection", () => {
  function makeCollection(name = "test_col") {
    return new Collection(name, {
      apiKey: "zdb_test",
      projectId: "proj-test",
      baseUrl: "https://mock.test",
    });
  }

  it("should have correct name and metadata", () => {
    const col = new Collection("my_col", {
      apiKey: "k",
      projectId: "p",
      baseUrl: "https://t.test",
      metadata: { description: "test" },
    });
    assert.equal(col.name, "my_col");
    assert.deepEqual(col.metadata, { description: "test" });
  });

  it("should add documents with auto-embedding", async () => {
    // Mock embed response
    pushResponse(200, {
      embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      model: "bge-m3",
      dimensions: 3,
      count: 2,
    });
    // Mock upsert response
    pushResponse(200, { success: true });

    const col = makeCollection();
    const result = await col.add({
      documents: ["hello", "world"],
      ids: ["id1", "id2"],
      metadatas: [{ topic: "greeting" }, { topic: "noun" }],
    });

    assert.deepEqual(result.ids, ["id1", "id2"]);
    assert.equal(fetchCalls.length, 2);

    // Verify embed call
    assert.ok(fetchCalls[0].url.includes("/embeddings/generate"));
    // Verify upsert call
    assert.ok(fetchCalls[1].url.includes("/vectors/upsert-batch"));
  });

  it("should add with pre-computed embeddings", async () => {
    pushResponse(200, { success: true });

    const col = makeCollection();
    const result = await col.add({
      ids: ["id1"],
      embeddings: [[0.1, 0.2, 0.3]],
      documents: ["hello"],
    });

    assert.deepEqual(result.ids, ["id1"]);
    // Only upsert call, no embedding call
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes("/vectors/upsert-batch"));
  });

  it("should auto-generate IDs when not provided", async () => {
    pushResponse(200, { embeddings: [[0.1, 0.2]], model: "bge-m3", dimensions: 2, count: 1 });
    pushResponse(200, { success: true });

    const col = makeCollection();
    const result = await col.add({ documents: ["test doc"] });

    assert.equal(result.ids.length, 1);
    assert.ok(result.ids[0].startsWith("vec_"));
  });

  it("should throw on empty add", async () => {
    const col = makeCollection();
    await assert.rejects(() => col.add({}), /Provide documents or embeddings/);
  });

  it("should query with queryTexts", async () => {
    // Mock embed
    pushResponse(200, { embeddings: [[0.1, 0.2, 0.3]], model: "bge-m3", dimensions: 3, count: 1 });
    // Mock search
    pushResponse(200, {
      results: [
        { vector_id: "id1", document: "hello", metadata: { topic: "greet" }, distance: 0.05 },
        { vector_id: "id2", document: "world", metadata: { topic: "noun" }, distance: 0.12 },
      ],
    });

    const col = makeCollection();
    const results = await col.query({ queryTexts: ["hi"], nResults: 2 });

    assert.deepEqual(results.ids, [["id1", "id2"]]);
    assert.deepEqual(results.documents, [["hello", "world"]]);
    assert.deepEqual(results.distances, [[0.05, 0.12]]);
    assert.equal(results.metadatas[0].length, 2);
  });

  it("should query with pre-computed embeddings", async () => {
    pushResponse(200, {
      results: [{ vector_id: "id1", document: "test", metadata: {}, distance: 0.01 }],
    });

    const col = makeCollection();
    const results = await col.query({ queryEmbeddings: [[0.1, 0.2, 0.3]], nResults: 1 });

    assert.deepEqual(results.ids, [["id1"]]);
    // No embed call
    assert.equal(fetchCalls.length, 1);
  });

  it("should throw on empty query", async () => {
    const col = makeCollection();
    await assert.rejects(() => col.query({}), /Provide queryTexts or queryEmbeddings/);
  });

  it("should pass where filter to query", async () => {
    pushResponse(200, { embeddings: [[0.1]], model: "bge-m3", dimensions: 1, count: 1 });
    pushResponse(200, { results: [] });

    const col = makeCollection();
    await col.query({ queryTexts: ["test"], where: { topic: "python" } });

    const searchBody = JSON.parse(fetchCalls[1].opts.body);
    assert.deepEqual(searchBody.filter_metadata, { topic: "python" });
  });

  it("should get all documents", async () => {
    pushResponse(200, {
      vectors: [
        { vector_id: "id1", document: "hello", metadata: { _collection: "test_col" } },
        { vector_id: "id2", document: "world", metadata: { _collection: "test_col" } },
      ],
    });

    const col = makeCollection();
    const result = await col.get();

    assert.deepEqual(result.ids, ["id1", "id2"]);
    assert.deepEqual(result.documents, ["hello", "world"]);
  });

  it("should get documents filtered by IDs", async () => {
    pushResponse(200, {
      vectors: [
        { vector_id: "id1", document: "hello", metadata: {} },
        { vector_id: "id2", document: "world", metadata: {} },
        { vector_id: "id3", document: "foo", metadata: {} },
      ],
    });

    const col = makeCollection();
    const result = await col.get({ ids: ["id1", "id3"] });

    assert.deepEqual(result.ids, ["id1", "id3"]);
    assert.deepEqual(result.documents, ["hello", "foo"]);
  });

  it("should get documents filtered by where", async () => {
    pushResponse(200, {
      vectors: [
        { vector_id: "id1", document: "py", metadata: { lang: "python" } },
        { vector_id: "id2", document: "js", metadata: { lang: "javascript" } },
      ],
    });

    const col = makeCollection();
    const result = await col.get({ where: { lang: "python" } });

    assert.deepEqual(result.ids, ["id1"]);
  });

  it("should delete by IDs", async () => {
    pushResponse(200, { success: true });

    const col = makeCollection();
    await col.delete({ ids: ["id1", "id2"] });

    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes("/vectors/delete"));
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.deepEqual(body.vector_ids, ["id1", "id2"]);
  });

  it("should throw on delete with no args", async () => {
    const col = makeCollection();
    await assert.rejects(() => col.delete({}), /Provide ids or where filter/);
  });

  it("should update require ids", async () => {
    const col = makeCollection();
    await assert.rejects(() => col.update({}), /ids required for update/);
  });

  it("should upsert delegate to add", async () => {
    pushResponse(200, { success: true });

    const col = makeCollection();
    const result = await col.upsert({
      ids: ["u1"],
      embeddings: [[0.1, 0.2]],
      documents: ["upsert test"],
    });

    assert.deepEqual(result.ids, ["u1"]);
  });

  it("should set namespace to collection name in upsert payload", async () => {
    pushResponse(200, { embeddings: [[0.1]], model: "bge-m3", dimensions: 1, count: 1 });
    pushResponse(200, { success: true });

    const col = makeCollection("my_namespace");
    await col.add({ documents: ["test"], ids: ["id1"] });

    const upsertBody = JSON.parse(fetchCalls[1].opts.body);
    assert.equal(upsertBody.vectors[0].namespace, "my_namespace");
    assert.equal(upsertBody.vectors[0].metadata._collection, "my_namespace");
  });

  it("should set Authorization header from apiKey", async () => {
    pushResponse(200, { success: true });

    const col = new Collection("test", {
      apiKey: "zdb_secret_key",
      projectId: "proj-1",
      baseUrl: "https://mock.test",
    });
    await col.add({ ids: ["id1"], embeddings: [[0.1]] });

    const headers = fetchCalls[0].opts.headers;
    assert.equal(headers.Authorization, "Bearer zdb_secret_key");
  });

  it("should handle API errors gracefully", async () => {
    pushResponse(500, "Internal Server Error");

    const col = makeCollection();
    await assert.rejects(
      () => col.add({ ids: ["id1"], embeddings: [[0.1]] }),
      /ZeroDB API error 500/,
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("should handle empty search results", async () => {
    pushResponse(200, { embeddings: [[0.1]], model: "bge-m3", dimensions: 1, count: 1 });
    pushResponse(200, { results: [] });

    const col = new Collection("empty", {
      apiKey: "k",
      projectId: "p",
      baseUrl: "https://t.test",
    });
    const results = await col.query({ queryTexts: ["nothing"] });

    assert.deepEqual(results.ids, [[]]);
    assert.deepEqual(results.documents, [[]]);
  });

  it("should handle multiple query texts", async () => {
    // Embed 2 queries
    pushResponse(200, { embeddings: [[0.1], [0.2]], model: "bge-m3", dimensions: 1, count: 2 });
    // Search result for query 1
    pushResponse(200, { results: [{ vector_id: "a", document: "doc_a", metadata: {}, distance: 0.1 }] });
    // Search result for query 2
    pushResponse(200, { results: [{ vector_id: "b", document: "doc_b", metadata: {}, distance: 0.2 }] });

    const col = new Collection("multi", {
      apiKey: "k",
      projectId: "p",
      baseUrl: "https://t.test",
    });
    const results = await col.query({ queryTexts: ["q1", "q2"], nResults: 1 });

    assert.equal(results.ids.length, 2);
    assert.deepEqual(results.ids[0], ["a"]);
    assert.deepEqual(results.ids[1], ["b"]);
  });

  it("should count fallback to get when count_only fails", async () => {
    // count_only request fails
    pushResponse(500, "not supported");
    // fallback get request
    pushResponse(200, {
      vectors: [
        { vector_id: "id1", document: "a", metadata: {} },
        { vector_id: "id2", document: "b", metadata: {} },
      ],
    });

    const col = new Collection("cnt", {
      apiKey: "k",
      projectId: "p",
      baseUrl: "https://t.test",
    });
    const n = await col.count();
    assert.equal(n, 2);
  });
});

// Restore original fetch (cleanup)
// globalThis.fetch = originalFetch;
