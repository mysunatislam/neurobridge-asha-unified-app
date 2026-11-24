import test from "node:test";
import assert from "node:assert/strict";
import { toRouteHandler } from "../src/server/node-adapter.ts";

// Keep route integration entirely local, including a failing cloud stub that
// makes any accidental urgent-request provider discovery visible.
process.env.NODE_ENV = "test";
process.env.ASHA_MEMORY_STORE = "1";
process.env.MAIRA_API_KEY = "offline-integration-test";
process.env.MAIRA_PROJECT_KEY = "offline-integration-test";
process.env.CRON_SECRET = "offline-cron-test";
let cloudCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  cloudCalls++;
  throw Error("Cloud access is disabled in route integration tests");
};
const { default: ashaHandler } = await import("../src/server/handlers/asha.js");
const { default: careHandler } = await import("../src/server/handlers/care.js");
const { default: clinicHandler } = await import("../src/server/handlers/clinic.js");
const { default: cleanupHandler } = await import("../src/server/handlers/cleanup.js");
const { store } = await import("../src/server/lib/common.js");
globalThis.fetch = originalFetch;

const request = (body, token) =>
  new Request("http://127.0.0.1/api/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });

test("The Next adapter enforces its default bound and rejects malformed JSON without caching", async () => {
  let calls = 0;
  const route = toRouteHandler((_req, res) => {
    calls++;
    res.json({ ok: true });
  });
  const oversized = await route(request({ text: "x".repeat(20000) }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
  const invalid = await route(
    new Request("http://127.0.0.1/api/test", { method: "POST", body: "{" }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), "no-store");
  assert.equal(calls, 0);
});

test("Migrated Asha and Care routes give urgent local guidance before auth, storage, consent or cloud discovery", async () => {
  const read = store.read;
  store.read = async () => {
    throw Error("Urgent preflight must not read private storage");
  };
  try {
    for (const handler of [ashaHandler, careHandler]) {
      for (const mode of ["chat", "interpret"]) {
        const response = await toRouteHandler(handler)(
          request({ patientId: "a".repeat(24), text: "I have chest pain", mode }),
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const result = await response.json();
        assert.equal(result.safety.level, "emergency");
        assert.equal(result.safety.allowLLM, false);
        assert.equal(result.proposal, undefined);
      }
    }
    assert.equal(cloudCalls, 0);
  } finally {
    store.read = read;
  }
  const options = await toRouteHandler(careHandler)(
    new Request("http://127.0.0.1/api/care", { method: "OPTIONS" }),
  );
  assert.equal(options.status, 204);
  assert.equal(await options.text(), "");
});

test("Migrated Clinic sharing accepts a valid selected record batch larger than the standard API cap", async () => {
  const route = toRouteHandler(clinicHandler, { maxBodyLength: 660000 });
  const post = async (input, token) => {
    const response = await route(request(input, token));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.storageMode, "local-memory");
    return result;
  };
  const admin = await post({ action: "create", confirmed: true, name: "Local clinic" });
  try {
    const patient = await post(
      { tenant: admin.tenant, action: "invite", role: "patient" },
      admin.token,
    );
    await post(
      { tenant: admin.tenant, action: "grant", modules: ["care"], confirmed: true },
      patient.token,
    );
    const input = {
      tenant: admin.tenant,
      action: "share",
      confirmed: true,
      records: Array.from({ length: 3 }, (_, index) => ({
        id: "local-" + index,
        module: "care",
        consent_scope: "care",
        value: { text: "x".repeat(9000) },
        units: "entry",
        source: "user",
        timestamp: new Date().toISOString(),
        model_id: "manual",
        model_version: "1",
        correction_status: "confirmed",
      })),
    };
    assert.ok(JSON.stringify(input).length > 20000);
    assert.equal((await post(input, patient.token)).shared, 3);
    const view = await post({ tenant: admin.tenant, action: "read" }, admin.token);
    assert.equal(view.patients[0].records.length, 3);
    const oversized = await route(request({ text: "x".repeat(660000) }));
    assert.equal(oversized.status, 413);
  } finally {
    await post(
      { tenant: admin.tenant, action: "delete", confirm: "DELETE" },
      admin.token,
    );
  }
});

test("Migrated authenticated cleanup still expires Everyday workspaces and old shared copies", async () => {
  const expired = new Date(Date.now() - 31 * 86400000).toISOString();
  const oldClinic = "asha-everyday/v1/clinics/route-cleanup/";
  const liveClinic = "asha-everyday/v1/clinics/route-active/";
  const session = "asha-live/v1/route-cleanup/";
  await store.write(oldClinic + "profile.json", { expiresAt: expired });
  await store.write(oldClinic + "patients/1.json", { label: "expired" });
  await store.write(liveClinic + "profile.json", {
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await store.write(liveClinic + "records/old.json", { sharedAt: expired });
  await store.write(session + "profile.json", {
    patientId: "route-cleanup",
    expiresAt: expired,
  });
  const route = toRouteHandler(cleanupHandler);
  const denied = await route(new Request("http://127.0.0.1/api/cleanup"));
  assert.equal(denied.status, 401);
  assert.ok(await store.read(oldClinic + "profile.json"));
  const response = await route(
    new Request("http://127.0.0.1/api/cleanup", {
      headers: { authorization: "Bearer " + process.env.CRON_SECRET },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json();
  assert.equal(result.expiredSessionsRemoved, 1);
  assert.equal(result.expiredClinicsRemoved, 1);
  assert.equal(result.everydayObjectsRemoved, 3);
  assert.equal(await store.read(oldClinic + "profile.json"), null);
  assert.equal(await store.read(liveClinic + "records/old.json"), null);
  assert.ok(await store.read(liveClinic + "profile.json"));
  await store.remove(await store.list(liveClinic));
});

test("The on-device demo can ask Asha as a guest and always gets a valid reply", async () => {
  const route = toRouteHandler(ashaHandler);
  const refused = await route(request({ guest: true, text: "What can you help me with?" }));
  assert.equal(refused.status, 400);
  const before = cloudCalls;
  const response = await route(
    request({ guest: true, consent: true, text: "What can you help me with?" }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  // The cloud stub fails, so the answer comes from Asha's guide, never an error.
  assert.ok(cloudCalls > before);
  assert.equal(result.answeredBy, "guide");
  assert.ok(result.reply.length > 20);
  assert.equal(result.proposal, undefined);
  const noGuest = await route(request({ consent: true, text: "Hello" }));
  assert.equal(noGuest.status, 401);
});
