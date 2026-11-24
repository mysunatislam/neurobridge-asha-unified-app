import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.ASHA_MEMORY_STORE = "1";
const SECRET = "w".repeat(40);
const { sign, verifyCallback, notifyRequestCreated } = await import(
  "../src/server/lib/workflow.js"
);
const { toRouteHandler } = await import("../src/server/node-adapter.ts");
const session = toRouteHandler(
  (await import("../src/server/handlers/session.js")).default,
);
const workflow = toRouteHandler(
  (await import("../src/server/handlers/workflow.js")).default,
);

const post = (route, body, headers = {}) =>
  route(
    new Request("http://127.0.0.1/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const signed = (action, patientId, requestId, ts = String(Date.now())) => ({
  "x-asha-timestamp": ts,
  "x-asha-signature": sign(SECRET, [ts, action, requestId, patientId]),
});

test("The webhook carries ids and the request kind only, signed over a canonical string", async () => {
  let sent;
  const status = await notifyRequestCreated(
    { patientId: "a".repeat(24), requestId: "r", kind: "water", at: "t" },
    {
      env: {
        ASHA_WORKFLOW_WEBHOOK_URL: "http://n8n.local/webhook/asha",
        ASHA_WORKFLOW_SECRET: SECRET,
      },
      now: () => 1700000000000,
      fetchImpl: async (url, options) => {
        sent = { url, options };
        return new Response("{}");
      },
    },
  );
  assert.equal(status, "sent");
  assert.deepEqual(Object.keys(JSON.parse(sent.options.body)).sort(), [
    "at",
    "kind",
    "patientId",
    "requestId",
    "type",
  ]);
  assert.equal(
    sent.options.headers["x-asha-signature"],
    sign(SECRET, [
      "1700000000000",
      "request.created",
      "r",
      "a".repeat(24),
      "water",
    ]),
  );
  assert.equal(await notifyRequestCreated({}, { env: {} }), "not_enabled");
  assert.equal(
    await notifyRequestCreated(
      {},
      {
        env: {
          ASHA_WORKFLOW_WEBHOOK_URL: "http://x",
          ASHA_WORKFLOW_SECRET: SECRET,
        },
        fetchImpl: async () => {
          throw new TypeError("down");
        },
      },
    ),
    "unavailable",
  );
});

test("Callbacks need a fresh timestamp and the right signature", () => {
  const env = {
    ASHA_WORKFLOW_WEBHOOK_URL: "http://x",
    ASHA_WORKFLOW_SECRET: SECRET,
  };
  const body = { action: "status", requestId: "r", patientId: "p" };
  const now = () => 1700000000000;
  const ok = {
    "x-asha-timestamp": "1700000000000",
    "x-asha-signature": sign(SECRET, ["1700000000000", "status", "r", "p"]),
  };
  assert.equal(verifyCallback(ok, body, { env, now }), true);
  assert.equal(
    verifyCallback(ok, { ...body, action: "escalate" }, { env, now }),
    false,
  );
  assert.equal(
    verifyCallback(ok, body, { env, now: () => 1700000000000 + 6 * 60 * 1000 }),
    false,
  );
  assert.equal(
    verifyCallback({ ...ok, "x-asha-signature": "0".repeat(64) }, body, {
      env,
      now,
    }),
    false,
  );
  assert.equal(verifyCallback(ok, body, { env: {}, now }), false);
});

test("Status and escalation follow the caregiver's acknowledgement", async () => {
  process.env.ASHA_WORKFLOW_WEBHOOK_URL = "http://127.0.0.1:9/never";
  process.env.ASHA_WORKFLOW_SECRET = SECRET;
  const created = await (
    await post(session, { action: "create", label: "Workflow test" })
  ).json();
  const { patientId, patientToken, caregiverToken } = created;
  const requestId = randomUUID();
  const event = await post(
    session,
    {
      action: "event",
      patientId,
      id: requestId,
      kind: "water",
      source: "touch",
      confirmed: true,
    },
    { authorization: "Bearer " + patientToken },
  );
  assert.equal((await event.json()).workflow, "unavailable");

  const unsigned = await post(workflow, {
    action: "status",
    patientId,
    requestId,
  });
  assert.equal(unsigned.status, 401);
  const fromBrowser = await post(
    workflow,
    { action: "status", patientId, requestId },
    {
      origin: "https://evil.example",
      ...signed("status", patientId, requestId),
    },
  );
  assert.equal(fromBrowser.status, 403);

  const status = await (
    await post(
      workflow,
      { action: "status", patientId, requestId },
      signed("status", patientId, requestId),
    )
  ).json();
  assert.equal(status.acknowledged, false);
  assert.equal(status.kind, "water");
  assert.equal(status.text, undefined);

  const first = await (
    await post(
      workflow,
      { action: "escalate", patientId, requestId },
      signed("escalate", patientId, requestId),
    )
  ).json();
  assert.equal(first.escalated, true);
  assert.equal(first.escalation.count, 1);

  await post(
    session,
    { action: "ack", patientId, id: requestId },
    { authorization: "Bearer " + caregiverToken },
  );
  const after = await (
    await post(
      workflow,
      { action: "escalate", patientId, requestId },
      signed("escalate", patientId, requestId),
    )
  ).json();
  assert.equal(after.acknowledged, true);
  assert.equal(after.escalated, false);
  delete process.env.ASHA_WORKFLOW_WEBHOOK_URL;
  delete process.env.ASHA_WORKFLOW_SECRET;
});
