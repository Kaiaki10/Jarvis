import { startSession, getSessionEmitter } from "./sessionManager.js";
import { createSession } from "../db/repo.js";

async function main() {
  const cwd = process.cwd();
  const session = createSession({
    title: "smoke test",
    cwd,
    permissionMode: "default",
  });

  console.log("Created session row:", session.id);

  const startPromise = startSession({
    id: session.id,
    prompt: "Reply with exactly the word: pong",
    cwd,
    permissionMode: "default",
  });

  await new Promise((r) => setTimeout(r, 50));
  const emitter = getSessionEmitter(session.id);
  emitter?.on("event", (event) => {
    console.log(`[event seq=${event.seq} type=${event.type}]`);
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "stream_event") {
      const e = payload.event as { type?: string; delta?: { type?: string; text?: string } };
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
        process.stdout.write(e.delta.text ?? "");
      }
    }
    if (event.type === "result") {
      console.log("\nRESULT:", JSON.stringify(payload, null, 2));
    }
  });

  await startPromise;
  console.log("Session finished.");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
