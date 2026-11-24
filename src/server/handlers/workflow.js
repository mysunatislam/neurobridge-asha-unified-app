import webpush from "web-push";
import { store, path } from "../lib/common.js";
import { verifyCallback } from "../lib/workflow.js";

const ESCALATE_KINDS = [
  "water",
  "food",
  "toilet",
  "comfort",
  "help",
  "message",
];

// Server-to-server endpoint for the caregiver escalation workflow (n8n).
// Every call is HMAC-signed; browsers are refused.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  if (req.headers.origin)
    return res.status(403).json({ error: "Origin not allowed" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (!verifyCallback(req.headers, b))
    return res.status(401).json({ error: "Unauthorized" });
  if (
    !/^[a-f0-9]{24}$/.test(b.patientId || "") ||
    !/^[a-f0-9-]{36}$/.test(b.requestId || "")
  )
    return res.status(400).json({ error: "Invalid request" });
  try {
    const event = await store.read(path(b.patientId, "events/" + b.requestId));
    if (!event || !ESCALATE_KINDS.includes(event.kind))
      return res.status(404).json({ error: "Request not found" });
    const receipt = await store.read(
      path(b.patientId, "receipts/" + b.requestId),
    );
    const status = {
      patientId: b.patientId,
      requestId: b.requestId,
      kind: event.kind,
      at: event.at,
      receivedAt: receipt?.receivedAt || null,
      acknowledgedAt: receipt?.acknowledgedAt || null,
      acknowledged: Boolean(receipt?.acknowledgedAt),
    };
    if (b.action === "status") return res.json(status);
    if (b.action !== "escalate")
      return res.status(400).json({ error: "Unknown action" });
    if (status.acknowledged)
      return res.json({ ...status, escalated: false, reason: "acknowledged" });
    const file = path(b.patientId, "escalations/" + b.requestId);
    const prior = await store.read(file);
    if ((prior?.count || 0) >= 3)
      return res.json({ ...status, escalated: false, reason: "limit" });
    const escalation = {
      count: (prior?.count || 0) + 1,
      firstAt: prior?.firstAt || new Date().toISOString(),
      lastAt: new Date().toISOString(),
    };
    await store.write(file, escalation, true);
    let push = "not_enabled";
    const subscription = await store.read(path(b.patientId, "push"));
    if (subscription && process.env.VAPID_PRIVATE_KEY) {
      try {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT,
          process.env.VAPID_PUBLIC_KEY,
          process.env.VAPID_PRIVATE_KEY,
        );
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: "Asha · request still waiting",
            body: "A request has not been acknowledged yet. Open your caregiver dashboard.",
            tag: b.patientId + "-reminder",
            url: "/care",
          }),
          { TTL: 300 },
        );
        push = "sent";
      } catch {
        push = "unavailable";
      }
    }
    return res.json({ ...status, escalated: true, escalation, push });
  } catch (e) {
    console.error("workflow failure", e?.name);
    return res.status(503).json({ error: "Workflow check unavailable" });
  }
}
