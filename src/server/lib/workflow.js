import { createHmac } from "node:crypto";
import { equal } from "./logic.js";

// Caregiver escalation through an external workflow engine (n8n).
// ASHA tells the workflow that a confirmed request exists; the workflow waits,
// asks ASHA whether the caregiver acknowledged it, and if not asks ASHA to
// remind the caregiver again. No request text or health detail is sent: only
// the request kind, its id, the patient id and a time.
// Both directions are signed with HMAC-SHA256 over a canonical string, so the
// workflow can verify with n8n's built-in Crypto node.
const MAX_SKEW_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 1500;

export const canonical = (parts) => parts.map((p) => String(p ?? "")).join(".");
export const sign = (secret, parts) =>
  createHmac("sha256", secret).update(canonical(parts)).digest("hex");

export function workflowConfig(env = process.env) {
  const url = env.ASHA_WORKFLOW_WEBHOOK_URL;
  const secret = env.ASHA_WORKFLOW_SECRET;
  return {
    enabled: Boolean(url && secret && secret.length >= 32),
    url,
    secret,
  };
}

/** Called after a confirmed request is stored. Never throws; returns a status word. */
export async function notifyRequestCreated(
  { patientId, requestId, kind, at },
  { env = process.env, fetchImpl = fetch, now = Date.now } = {},
) {
  const config = workflowConfig(env);
  if (!config.enabled) return "not_enabled";
  const timestamp = String(now());
  const body = { type: "request.created", patientId, requestId, kind, at };
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-asha-timestamp": timestamp,
        "x-asha-signature": sign(config.secret, [
          timestamp,
          "request.created",
          requestId,
          patientId,
          kind,
        ]),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? "sent" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Verifies a callback from the workflow: fresh timestamp and a matching signature. */
export function verifyCallback(
  headers,
  body,
  { env = process.env, now = Date.now } = {},
) {
  const config = workflowConfig(env);
  if (!config.enabled) return false;
  const timestamp = String(headers["x-asha-timestamp"] || "");
  const signature = String(headers["x-asha-signature"] || "");
  if (
    !/^\d{10,16}$/.test(timestamp) ||
    Math.abs(now() - Number(timestamp)) > MAX_SKEW_MS
  )
    return false;
  const expected = sign(config.secret, [
    timestamp,
    body?.action,
    body?.requestId,
    body?.patientId,
  ]);
  return equal(signature, expected);
}
