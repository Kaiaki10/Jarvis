import express, { type Request, type Response } from "express";
import type { SessionEventRecord } from "@jarvis/shared";
import { lanAddress, verifyApprovalToken } from "../security/approvalToken.js";
import { resolvePermission } from "../sessions/sessionManager.js";
import { getSession, listSessionEvents } from "../db/repo.js";

/**
 * A second, tiny HTTP listener bound to the LAN interface instead of
 * 127.0.0.1 — deliberately separate from the main app in server.ts, which
 * stays loopback-only exactly as before. A push notification link means
 * nothing if it only resolves on the phone itself, and 127.0.0.1 in a link
 * means exactly that. Rather than widen the main app's binding (which would
 * put every route, including /shutdown, within reach of anything else on the
 * network), only these two routes get a second address. They carry their own
 * signed, single-purpose, short-lived token (`security/approvalToken.ts`) —
 * not the dashboard's bearer token — so nothing here needs the main app's
 * auth guard to do its job.
 */

const APPROVE_PORT = Number(process.env.JARVIS_APPROVE_PORT ?? 4318);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { background:#0a0a0f; color:#e8e8f0; font-family:-apple-system,system-ui,sans-serif; margin:0; padding:16px; }
  .card { max-width:420px; margin:32px auto; background:#14141c; border:1px solid rgba(255,255,255,0.1); border-radius:16px; padding:24px; }
  h1 { font-size:18px; margin:0 0 8px; line-height:1.4; }
  p { color:#9a9aad; line-height:1.5; }
  pre { background:#0a0a0f; border-radius:8px; padding:12px; overflow-x:auto; font-size:12px; color:#c8c8d8; white-space:pre-wrap; word-break:break-word; }
  form { display:flex; gap:12px; margin-top:20px; }
  button { flex:1; padding:14px; border-radius:10px; border:none; font-size:16px; font-weight:600; -webkit-tap-highlight-color:transparent; }
  .allow { background:#6366f1; color:white; }
  .deny { background:rgba(255,255,255,0.08); color:#e8e8f0; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function expiredPage(): string {
  return page(
    "Link expired",
    `<div class="card"><h1>This link is no longer valid</h1><p>It may have already been answered, timed out, or expired. Open the Jarvis dashboard to check.</p></div>`
  );
}

function findPendingRequest(
  sessionId: string,
  requestId: string
): { toolName: string; input: unknown } | null {
  const events = listSessionEvents(sessionId);
  const responded = new Set(
    events
      .filter((e) => e.type === "permission_response")
      .map((e) => (e.payload as { requestId: string }).requestId)
  );
  if (responded.has(requestId)) return null;
  const request = [...events]
    .reverse()
    .find(
      (e: SessionEventRecord) =>
        e.type === "permission_request" && (e.payload as { requestId: string }).requestId === requestId
    );
  if (!request) return null;
  const payload = request.payload as { toolName: string; input: unknown };
  return { toolName: payload.toolName, input: payload.input };
}

const app = express();
app.use(express.urlencoded({ extended: false }));

app.get("/approve/:token", (req: Request, res: Response) => {
  const payload = verifyApprovalToken(req.params.token);
  if (!payload) {
    res.status(410).send(expiredPage());
    return;
  }
  const session = getSession(payload.sessionId);
  const pending = findPendingRequest(payload.sessionId, payload.requestId);
  if (!pending) {
    res
      .status(410)
      .send(
        page(
          "Already answered",
          `<div class="card"><h1>Already answered</h1><p>This request was already resolved, from here or from the dashboard.</p></div>`
        )
      );
    return;
  }
  res.send(
    page(
      "Jarvis needs a decision",
      `<div class="card">
        <h1>${escapeHtml(session?.title ?? "Jarvis")} wants to use ${escapeHtml(pending.toolName)}</h1>
        <pre>${escapeHtml(JSON.stringify(pending.input, null, 2)).slice(0, 2_000)}</pre>
        <form method="post" action="/approve/${encodeURIComponent(req.params.token)}">
          <button class="deny" name="decision" value="deny" type="submit">Deny</button>
          <button class="allow" name="decision" value="allow" type="submit">Approve</button>
        </form>
      </div>`
    )
  );
});

app.post("/approve/:token", (req: Request, res: Response) => {
  const payload = verifyApprovalToken(req.params.token);
  const decision =
    req.body?.decision === "allow" ? "allow" : req.body?.decision === "deny" ? "deny" : null;
  if (!payload || !decision) {
    res.status(410).send(expiredPage());
    return;
  }
  const ok = resolvePermission(payload.sessionId, payload.requestId, decision);
  if (!ok) {
    res
      .status(410)
      .send(
        page(
          "Already answered",
          `<div class="card"><h1>Already answered</h1><p>This request was already resolved, from here or from the dashboard.</p></div>`
        )
      );
    return;
  }
  res.send(
    page(
      decision === "allow" ? "Approved" : "Denied",
      `<div class="card"><h1>${decision === "allow" ? "Approved" : "Denied"}</h1><p>Jarvis has been told. You can close this page.</p></div>`
    )
  );
});

export function startApproveServer(): void {
  const host = lanAddress();
  if (!host) {
    console.warn(
      "[approve] no LAN address found; push approval links will not be reachable from your phone"
    );
    return;
  }
  app.listen(APPROVE_PORT, host, () => {
    console.log(`[approve] one-tap approval listening on http://${host}:${APPROVE_PORT} (LAN only)`);
  });
}
