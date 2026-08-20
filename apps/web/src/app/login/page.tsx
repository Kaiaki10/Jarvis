"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, ShieldCheck } from "lucide-react";
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BASE_URL } from "@/lib/api";

type Status = "checking" | "register" | "login" | "unsupported";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Something went wrong");
  return body;
}

export default function LoginPage() {
  // useSearchParams() opts this tree out of static rendering unless it's
  // isolated behind Suspense — otherwise the build fails.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) {
      setStatus("unsupported");
      return;
    }
    fetchJson<{ hasOperator: boolean }>("/auth/status")
      .then(({ hasOperator }) => setStatus(hasOperator ? "login" : "register"))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not reach Jarvis"));
  }, []);

  function afterLogin() {
    const from = searchParams.get("from");
    router.replace(from && from.startsWith("/") ? from : "/");
  }

  async function handleRegister() {
    setError(null);
    setBusy(true);
    try {
      const { ceremonyId, options } = await fetchJson<{ ceremonyId: string; options: unknown }>(
        "/auth/webauthn/register/options",
        { method: "POST" }
      );
      const response = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      await fetchJson("/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({ ceremonyId, response }),
      });
      afterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your passkey");
      setBusy(false);
    }
  }

  async function handleLogin() {
    setError(null);
    setBusy(true);
    try {
      const { ceremonyId, options } = await fetchJson<{ ceremonyId: string; options: unknown }>(
        "/auth/webauthn/login/options",
        { method: "POST" }
      );
      const response = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      await fetchJson("/auth/webauthn/login/verify", {
        method: "POST",
        body: JSON.stringify({ ceremonyId, response }),
      });
      afterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify your passkey");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Card elevation={2}>
          <CardHeader
            title="Jarvis"
            description={
              status === "register"
                ? "Set up a passkey to become this install's operator."
                : "Log in with your passkey."
            }
            icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
          />
          <CardBody className="flex flex-col gap-4">
            {status === "checking" && <p className="text-label text-muted">Checking…</p>}

            {status === "unsupported" && (
              <p className="text-label text-danger">
                This browser does not support passkeys. Try a recent Chrome, Edge, or Safari.
              </p>
            )}

            {status === "register" && (
              <Button variant="primary" onClick={handleRegister} disabled={busy} className="w-full">
                <KeyRound className="h-4 w-4" strokeWidth={1.75} />
                {busy ? "Waiting for your passkey…" : "Create your passkey"}
              </Button>
            )}

            {status === "login" && (
              <Button variant="primary" onClick={handleLogin} disabled={busy} className="w-full">
                <KeyRound className="h-4 w-4" strokeWidth={1.75} />
                {busy ? "Waiting for your passkey…" : "Log in with passkey"}
              </Button>
            )}

            {error && <p className="text-label text-danger">{error}</p>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
