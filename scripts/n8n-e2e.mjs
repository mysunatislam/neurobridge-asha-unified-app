#!/usr/bin/env node
// End-to-end check of the n8n caregiver escalation workflow against ASHA's
// real session and workflow handlers (in-memory store, no cloud).
//   N8N_BIN=/path/to/n8n node scripts/n8n-e2e.mjs
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const N8N = process.env.N8N_BIN || "n8n";
const ASHA_PORT = 4192; // 4190 is on the fetch "bad ports" list
const N8N_PORT = 5679;
const SECRET = randomBytes(24).toString("hex");
const WAIT_SECONDS = 4;
process.env.NODE_ENV = "test";
process.env.ASHA_MEMORY_STORE = "1";
process.env.ASHA_WORKFLOW_SECRET = SECRET;
process.env.ASHA_WORKFLOW_WEBHOOK_URL = `http://127.0.0.1:${N8N_PORT}/webhook/asha-request`;

const { toRouteHandler } = await import("../src/server/node-adapter.ts");
const session = toRouteHandler(
  (await import("../src/server/handlers/session.js")).default,
);
const workflow = toRouteHandler(
  (await import("../src/server/handlers/workflow.js")).default,
);
const { store, path } = await import("../src/server/lib/common.js");
const calls = [];

const asha = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const route = req.url.startsWith("/api/workflow") ? workflow : session;
  if (req.url.startsWith("/api/workflow"))
    calls.push(JSON.parse(body || "{}").action);
  const response = await route(
    new Request(`http://127.0.0.1:${ASHA_PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: body || undefined,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});
await new Promise((resolve) => asha.listen(ASHA_PORT, "127.0.0.1", resolve));

const home = mkdtempSync(join(tmpdir(), "asha-n8n-"));
const env = {
  ...process.env,
  NODE_ENV: "production", // under NODE_ENV=test n8n printed nothing and never opened its port
  N8N_USER_FOLDER: home,
  N8N_PORT: String(N8N_PORT),
  N8N_LISTEN_ADDRESS: "127.0.0.1",
  N8N_DIAGNOSTICS_ENABLED: "false",
  N8N_PERSONALIZATION_ENABLED: "false",
  N8N_RUNNERS_ENABLED: "false",
  N8N_BLOCK_ENV_ACCESS_IN_NODE: "false",
  ASHA_BASE_URL: `http://127.0.0.1:${ASHA_PORT}`,
  ASHA_ESCALATE_AFTER_SECONDS: String(WAIT_SECONDS),
};
const workflowFile = new URL(
  "../workflows/n8n/asha-caregiver-escalation.json",
  import.meta.url,
).pathname;
const id = "ashaEscalation1";
const importable = join(home, "workflow.json");
writeFileSync(
  importable,
  JSON.stringify({
    ...JSON.parse((await import("node:fs")).readFileSync(workflowFile, "utf8")),
    id,
    active: true,
  }),
);
execFileSync(N8N, ["import:workflow", `--input=${importable}`], {
  env,
  stdio: "inherit",
});
execFileSync(N8N, ["update:workflow", `--id=${id}`, "--active=true"], {
  env,
  stdio: "inherit",
});
const n8n = spawn(N8N, ["start"], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
n8n.stdout.on("data", (d) => (log += d));
n8n.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "n8n ready" is logged before migrations finish, so poll readiness instead.
const ready = async () =>
  fetch(`http://127.0.0.1:${N8N_PORT}/healthz/readiness`).then(
    (r) => r.ok,
    () => false,
  );
for (let i = 0; i < 180 && !(await ready()); i++) await sleep(1000);
for (let i = 0; i < 30 && !/Editor is now accessible/i.test(log); i++)
  await sleep(1000);
await sleep(1000);

const post = (body, token) =>
  fetch(`http://127.0.0.1:${ASHA_PORT}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const results = {};
try {
  const { patientId, patientToken, caregiverToken } = await post({
    action: "create",
    label: "n8n e2e",
  });
  const waiting = randomUUID();
  const answered = randomUUID();
  const first = await post(
    {
      action: "event",
      patientId,
      id: waiting,
      kind: "water",
      source: "touch",
      confirmed: true,
    },
    patientToken,
  );
  const second = await post(
    {
      action: "event",
      patientId,
      id: answered,
      kind: "food",
      source: "touch",
      confirmed: true,
    },
    patientToken,
  );
  await post({ action: "ack", patientId, id: answered }, caregiverToken);
  results.webhook = [first.workflow, second.workflow];
  await sleep((WAIT_SECONDS + 8) * 1000);
  results.unacknowledged = await store.read(
    path(patientId, "escalations/" + waiting),
  );
  results.acknowledged = await store.read(
    path(patientId, "escalations/" + answered),
  );
  results.callbacks = calls;
  // A forged webhook must not reach ASHA.
  const forged = await fetch(process.env.ASHA_WORKFLOW_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-asha-timestamp": String(Date.now()),
      "x-asha-signature": "0".repeat(64),
    },
    body: JSON.stringify({ patientId, requestId: randomUUID(), kind: "water" }),
  });
  results.forgedWebhookStatus = forged.status;
  const before = calls.length;
  await sleep((WAIT_SECONDS + 4) * 1000);
  results.forgedCallbacks = calls.length - before;
} catch (error) {
  results.error = String(error?.cause?.code || error?.message || error);
} finally {
  n8n.kill("SIGTERM");
  asha.close();
}
const ok =
  !results.error &&
  results.webhook?.every((w) => w === "sent") &&
  results.unacknowledged?.count === 1 &&
  !results.acknowledged &&
  results.forgedCallbacks === 0;
console.log(JSON.stringify({ ok, ...results }, null, 2));
if (!ok) console.error(log.split("\n").slice(-40).join("\n"));
process.exit(ok ? 0 : 1);
