import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Local only: the in-memory store, no cloud provider, no network.
process.env.NODE_ENV = "test";
process.env.ASHA_MEMORY_STORE = "1";
const { handleMcp, MCP_SERVERS, mcpIndex } = await import(
  "../src/server/mcp/servers.js"
);
const { default: sessionHandler } = await import(
  "../src/server/handlers/session.js"
);
const { toRouteHandler } = await import("../src/server/node-adapter.ts");
const session = toRouteHandler(sessionHandler);

let nextId = 1;
const rpc = (key, method, params = {}, headers = {}) =>
  handleMcp(
    new Request(`http://127.0.0.1/api/mcp/${key}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
    key,
  ).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
const call = async (key, name, args, headers) => {
  const { status, body } = await rpc(
    key,
    "tools/call",
    { name, arguments: args },
    headers,
  );
  assert.equal(status, 200);
  return body.result;
};

test("All five ASHA MCP servers initialize over Streamable HTTP and list their tools", async () => {
  assert.equal(Object.keys(MCP_SERVERS).length, 5);
  for (const [key, server] of Object.entries(MCP_SERVERS)) {
    const init = await rpc(key, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "asha-test", version: "1" },
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.serverInfo.name, server.name);
    const list = await rpc(key, "tools/list");
    assert.deepEqual(
      list.body.result.tools.map((tool) => tool.name).sort(),
      [...server.tools].sort(),
    );
  }
  const index = mcpIndex("https://example.test");
  assert.equal(index.servers.length, 5);
  assert.ok(
    index.servers.every((s) =>
      s.url.startsWith("https://example.test/api/mcp/"),
    ),
  );
});

test("Knowledge search returns app-guide evidence for English and Bangla questions", async () => {
  const en = await call("knowledge", "search_app_guide", {
    query: "Do ordinary blinks confirm a request?",
  });
  assert.ok(en.structuredContent.passages.length > 0);
  assert.ok(
    en.structuredContent.passages.every((p) => p.source === "app-guide"),
  );
  const bn = await call("knowledge", "search_app_guide", {
    query: "পলক দিয়ে অনুরোধ নিশ্চিত",
  });
  assert.ok(bn.structuredContent.passages.length > 0);
  const guide = await call("knowledge", "get_module_guide", {
    module: "caregiver",
  });
  assert.match(guide.structuredContent.guide, /caregiver/i);
  const resources = await rpc("knowledge", "resources/list");
  assert.ok(
    resources.body.result.resources.some(
      (r) => r.uri === "asha://guide/companion",
    ),
  );
});

test("Nutrition tools add declared weights and refuse unknown foods", async () => {
  const found = await call("nutrition", "search_foods", { query: "rice" });
  const rice = found.structuredContent.foods.find(
    (f) => f.id === "rice-cooked",
  );
  assert.ok(rice);
  const meal = await call("nutrition", "calculate_meal", {
    ingredients: [{ foodId: "rice-cooked", grams: 200 }],
  });
  assert.equal(
    meal.structuredContent.nutrients.kcal.min.toFixed(3),
    ((rice.per100g.kcal * 200) / 100).toFixed(3),
  );
  const unknown = await call("nutrition", "calculate_meal", {
    ingredients: [{ foodId: "not-a-food", grams: 10 }],
  });
  assert.equal(unknown.isError, true);
});

test("Safety tool marks chest pain as an emergency in English and Bangla, and never allows the LLM", async () => {
  for (const text of ["I have chest pain and feel sweaty", "আমার বুকে ব্যথা"]) {
    const out = await call("safety", "check_symptom_safety", { text });
    assert.equal(out.structuredContent.level, "emergency");
    assert.equal(out.structuredContent.allowLLM, false);
    assert.equal(out.structuredContent.automaticContact, false);
    assert.match(out.structuredContent.message, /999/);
  }
  const routine = await call("safety", "check_symptom_safety", {
    text: "I slept badly last night",
  });
  assert.equal(routine.structuredContent.level, "routine");
});

test("Caregiver tools need the caregiver's own token and acknowledge a real request", async () => {
  const created = await session(
    new Request("http://127.0.0.1/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create", label: "MCP test" }),
    }),
  );
  const { patientId, patientToken, caregiverToken } = await created.json();
  const requestId = randomUUID();
  const sent = await session(
    new Request("http://127.0.0.1/api/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + patientToken,
      },
      body: JSON.stringify({
        action: "event",
        patientId,
        id: requestId,
        kind: "water",
        source: "touch",
        confirmed: true,
      }),
    }),
  );
  assert.equal(sent.status, 200);

  const asCaregiver = { authorization: "Bearer " + caregiverToken };
  const asPatient = { authorization: "Bearer " + patientToken };
  const refused = await call(
    "caregiver",
    "list_requests",
    { patientId },
    asPatient,
  );
  assert.equal(refused.isError, true);
  const none = await call("caregiver", "list_requests", { patientId });
  assert.equal(none.isError, true);

  const listed = await call(
    "caregiver",
    "list_requests",
    { patientId },
    asCaregiver,
  );
  assert.equal(listed.structuredContent.requests[0].id, requestId);
  assert.equal(listed.structuredContent.requests[0].kind, "water");
  assert.equal(listed.structuredContent.requests[0].receipt, null);

  const ack = await call(
    "caregiver",
    "acknowledge_request",
    { patientId, requestId },
    asCaregiver,
  );
  assert.ok(ack.structuredContent.receipt.acknowledgedAt);
  const after = await call(
    "caregiver",
    "list_requests",
    { patientId },
    asCaregiver,
  );
  assert.ok(after.structuredContent.requests[0].receipt.acknowledgedAt);
});

test("Models server lists pinned on-device weights, cloud routes and the local mode", async () => {
  const out = await call("models", "list_models", {});
  const files = out.structuredContent.onDevice.map((m) => m.file);
  assert.ok(files.includes("models/yolo26n-pose.onnx"));
  assert.ok(
    out.structuredContent.onDevice.every((m) =>
      /^[a-f0-9]{64}$/.test(m.sha256),
    ),
  );
  assert.deepEqual(out.structuredContent.cloud.map((r) => r.task).sort(), [
    "bilingual",
    "conversation",
    "speech",
  ]);
  assert.ok(out.structuredContent.local.length >= 3);
  const routed = await call("models", "route_task", { task: "bilingual" });
  assert.equal(routed.structuredContent.cloud.model, "claude-opus-4-8");
});

test("The MCP endpoint refuses foreign origins, unknown servers, GET streams and oversized bodies", async () => {
  const foreign = await handleMcp(
    new Request("http://127.0.0.1/api/mcp/safety", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    "safety",
  );
  assert.equal(foreign.status, 403);
  const unknown = await handleMcp(
    new Request("http://127.0.0.1/api/mcp/x", { method: "POST", body: "{}" }),
    "x",
  );
  assert.equal(unknown.status, 404);
  const get = await handleMcp(
    new Request("http://127.0.0.1/api/mcp/safety"),
    "safety",
  );
  assert.equal(get.status, 405);
  const big = await handleMcp(
    new Request("http://127.0.0.1/api/mcp/safety", {
      method: "POST",
      body: "x".repeat(70000),
    }),
    "safety",
  );
  assert.equal(big.status, 413);
  for (const response of [foreign, unknown, get, big])
    assert.equal(response.headers.get("cache-control"), "no-store");
});
