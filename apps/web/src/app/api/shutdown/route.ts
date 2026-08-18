export const runtime = "nodejs";

export async function POST() {
  // The production service is loopback-only. This endpoint lets the restart
  // script stop the S4U-hosted process from inside its own security context.
  setTimeout(() => process.exit(0), 100);
  return Response.json({ ok: true }, { status: 202 });
}
