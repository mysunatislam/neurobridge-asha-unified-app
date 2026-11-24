# Caregiver escalation workflow (n8n)

When a patient confirms a request (water, food, toilet, comfort, help or a message), ASHA already sends the caregiver a web push. If nobody acknowledges it, an n8n workflow sends a reminder. The workflow is in [`workflows/n8n/asha-caregiver-escalation.json`](../workflows/n8n/asha-caregiver-escalation.json) and can be imported into any n8n 1.x instance.

## Flow

1. **New confirmed request** (Webhook, `POST /webhook/asha-request`). ASHA calls it after the request is stored. The body holds only the request kind, the request id, the patient id and a time. No request text or health details are sent.
2. **Expected signature** (Crypto) and **Verify signature** (Code). The workflow recomputes the HMAC-SHA256 signature and stops if it does not match or if the timestamp is more than five minutes old.
3. **Give the caregiver time** (Wait). It waits `ASHA_ESCALATE_AFTER_SECONDS`, which defaults to 300 seconds.
4. **Prepare status check**, **Sign status check** and **Ask ASHA if acknowledged** (Code, Crypto, HTTP). The workflow asks `POST /api/workflow` with `action: "status"`.
5. **Still waiting?** (Code). It stops if the caregiver has acknowledged the request.
6. **Sign reminder** and **Remind the caregiver** (Crypto, HTTP). The workflow calls `POST /api/workflow` with `action: "escalate"`. ASHA records the escalation and sends the caregiver a push: "Asha · request still waiting".

## Safety rules in ASHA

- Both directions are signed with HMAC-SHA256 over a dotted canonical string. ASHA signs `timestamp.request.created.requestId.patientId.kind`, and the workflow signs `timestamp.action.requestId.patientId`. The comparison is constant time.
- `/api/workflow` accepts only POST, refuses any request that carries a browser `Origin` header, and rejects unsigned or stale calls with 401.
- ASHA re-reads the request and its receipt from its own store. The workflow cannot invent a request, and it cannot change what was asked.
- A request that is already acknowledged is never escalated. Each request gets at most three reminders.
- The webhook call runs after the request is stored and the push is sent. It has a 1.5 second timeout, and a failure is reported as `workflow: "unavailable"` without failing the patient's request. Without `ASHA_WORKFLOW_WEBHOOK_URL` and a `ASHA_WORKFLOW_SECRET` of at least 32 characters, nothing is sent.

## n8n settings

| Variable                       | Value                                              |
| ------------------------------ | -------------------------------------------------- |
| `ASHA_WORKFLOW_SECRET`         | The same secret as ASHA's `ASHA_WORKFLOW_SECRET`   |
| `ASHA_BASE_URL`                | ASHA's base URL, for example a preview deployment  |
| `ASHA_ESCALATE_AFTER_SECONDS`  | Optional. Seconds to wait before checking          |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false`, so the nodes can read the variables above |

## End-to-end check

`npm run e2e:n8n` (with `N8N_BIN` pointing to an n8n binary) starts ASHA's real session and workflow handlers on an in-memory store, imports and activates the workflow in a fresh n8n, and starts n8n with a 4 second wait. It then:

1. creates a patient session and sends two confirmed requests,
2. has the caregiver acknowledge the second one,
3. checks, after the wait, that only the unacknowledged request was escalated, and
4. sends a webhook with a forged signature and checks that n8n makes no call to ASHA.

Result on 2026-11-18 with n8n 1.123.91 (self-hosted, local):

```json
{
  "ok": true,
  "webhook": ["sent", "sent"],
  "unacknowledged": { "count": 1 },
  "acknowledged": null,
  "callbacks": ["status", "status", "escalate"],
  "forgedWebhookStatus": 200,
  "forgedCallbacks": 0
}
```

The forged webhook still gets HTTP 200, because the webhook answers as soon as it receives a call. The Verify signature node then stops that execution, so ASHA receives nothing.

Not yet done: running the workflow against a deployed ASHA preview with a hosted n8n instance, and a reminder on a real caregiver phone.
