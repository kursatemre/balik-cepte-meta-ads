/**
 * Apple Search Ads (ASA) Campaign Management API v5 baglantisi.
 *
 * Auth, Meta'dan tamamen farkli: uzun omurlu bir access token yerine,
 * her ~1 saatte bir, kendi imzaladigin bir JWT ("client secret") ile
 * yeni bir access token istiyorsun. Bu dosyada dogrulanan (2026-09-02,
 * gercek hesaba karsi) akis:
 *
 *   1. ES256 imzali JWT uret: header {alg:ES256, kid:ASA_KEY_ID},
 *      payload {sub:ASA_CLIENT_ID, aud:"https://appleid.apple.com",
 *      iat, exp (<=180 gun), iss:ASA_TEAM_ID}
 *   2. POST https://appleid.apple.com/auth/oauth2/token
 *      (grant_type=client_credentials, client_id, client_secret=<JWT>,
 *      scope=searchadsorg) -> access_token (1 saat gecerli)
 *   3. Her API cagrisinda: Authorization: Bearer <access_token>,
 *      X-AP-Context: orgId=<ASA_ORG_ID>
 *
 * NOT: v4 API deprecated (INVALID_API_VERSION hatasi verdi) - v5 kullan.
 *
 * Web Crypto (crypto.subtle) kullanilir - ECDSA sign() ciktisi zaten JWS'nin
 * bekledigi ham r||s (IEEE P1363) formatinda, Node'daki gibi DER->P1363
 * cevrimine gerek yok. Tek sart: private key PKCS8 formatinda olmali
 * (openssl ecparam SEC1 uretir, `openssl pkcs8 -topk8 -nocrypt` ile
 * cevrildi - bkz. worker/README.md).
 */

const API_BASE = "https://api.searchads.apple.com/api/v5";
const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const CLIENT_ASSERTION_TTL_SECONDS = 175 * 24 * 60 * 60; // 175 gun (max 180)

export interface AsaEnv {
  ASA_CLIENT_ID: string;
  ASA_TEAM_ID: string;
  ASA_KEY_ID: string;
  ASA_ORG_ID: string;
  ASA_PRIVATE_KEY: string;
}

interface AsaErrorItem {
  messageCode?: string;
  message?: string;
  field?: string;
}

export class AsaApiError extends Error {
  items: AsaErrorItem[];

  constructor(body: { error?: { errors?: AsaErrorItem[] } } | undefined, status: number) {
    const items = body?.error?.errors ?? [];
    const summary = items.map((e) => e.message ?? e.messageCode).filter(Boolean).join("; ") || `HTTP ${status}`;
    super(summary);
    this.name = "AsaApiError";
    this.items = items;
  }

  format(): string {
    if (!this.items.length) return this.message;
    return this.items
      .map((e) => `[${e.messageCode ?? "?"}${e.field ? "/" + e.field : ""}] ${e.message ?? ""}`)
      .join("\n");
  }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/** PKCS8 PEM -> CryptoKey (ECDSA P-256, sign icin). */
async function importPrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
  const body = pkcs8Pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function buildClientAssertion(env: AsaEnv): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: env.ASA_KEY_ID };
  const payload = {
    sub: env.ASA_CLIENT_ID,
    aud: "https://appleid.apple.com",
    iat: now,
    exp: now + CLIENT_ASSERTION_TTL_SECONDS,
    iss: env.ASA_TEAM_ID,
  };
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const key = await importPrivateKey(env.ASA_PRIVATE_KEY);
  // Web Crypto ECDSA sign -> ham r||s (IEEE P1363), JWS ES256'nin bekledigi format.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

// Isolate canli kaldigi surece 1 saatlik access token'i cache'ler - her
// tool cagrisinda yeniden istemeye gerek yok. Cold start'ta basitce bos
// baslar, ilk cagrida yeniden alinir (yanlis/bayat token riski yok).
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(env: AsaEnv): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const clientSecret = await buildClientAssertion(env);
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.ASA_CLIENT_ID,
    client_secret: clientSecret,
    scope: "searchadsorg",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Host: "appleid.apple.com", "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Apple OAuth token alinamadi: ${json.error ?? res.status} ${json.error_description ?? ""}`);
  }

  // Guvenlik payi icin 60sn erken suresi dolmus say.
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.value;
}

interface AsaRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export async function asaRequest(env: AsaEnv, path: string, opts: AsaRequestOptions = {}): Promise<any> {
  const token = await getAccessToken(env);
  let url = `${API_BASE}${path}`;
  if (opts.query) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) usp.set(k, String(v));
    }
    const qs = usp.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-AP-Context": `orgId=${env.ASA_ORG_ID}`,
      "Content-Type": "application/json",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const json = (await res.json().catch(() => undefined)) as
    | { data?: unknown; error?: { errors?: AsaErrorItem[] } }
    | undefined;
  if (!res.ok || json?.error) {
    throw new AsaApiError(json, res.status);
  }
  return json;
}
