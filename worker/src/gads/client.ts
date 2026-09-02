/**
 * Google Ads API v25 (REST) baglantisi.
 *
 * Auth Meta'ya benzer (uzun omurlu refresh_token -> kisa omurlu access_token),
 * ASA'nin JWT imzalamasindan farkli - standart OAuth2 refresh_token grant:
 *
 *   POST https://oauth2.googleapis.com/token
 *   (grant_type=refresh_token, client_id, client_secret, refresh_token)
 *   -> access_token (~1 saat)
 *
 * DIKKAT (bu oturumda dogrulandi): OAuth consent screen "Testing" modundayken
 * refresh_token SADECE 7 GUN gecerli oluyor. "In production"a alinana kadar
 * bu sure asilirsa OAuth consent akisini (worker/README.md) tekrarlamak
 * gerekir.
 *
 * Her istekte 3 header sart (bu oturumda listAccessibleCustomers ile
 * dogrulandi): Authorization: Bearer <token>, developer-token: <...>,
 * login-customer-id: <MCC id, tiresiz>.
 *
 * Google Ads parasal alanlari MICROS kullanir (1 birim = 1_000_000 micros) -
 * Meta'nin kurus'undan, ASA'nin ondalik string'inden farkli bir cevrim.
 */

const API_BASE = "https://googleads.googleapis.com/v25";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GadsEnv {
  GADS_CLIENT_ID: string;
  GADS_CLIENT_SECRET: string;
  GADS_REFRESH_TOKEN: string;
  GADS_DEVELOPER_TOKEN: string;
  GADS_LOGIN_CUSTOMER_ID: string;
  GADS_CUSTOMER_ID?: string;
}

interface GadsErrorItem {
  errorCode?: Record<string, string>;
  message?: string;
}

export class GadsApiError extends Error {
  items: GadsErrorItem[];

  constructor(body: { error?: { message?: string; details?: { errors?: GadsErrorItem[] }[] } } | undefined, status: number) {
    const items = body?.error?.details?.flatMap((d) => d.errors ?? []) ?? [];
    const summary = items.map((e) => e.message).filter(Boolean).join("; ") || body?.error?.message || `HTTP ${status}`;
    super(summary);
    this.name = "GadsApiError";
    this.items = items;
  }

  format(): string {
    if (!this.items.length) return this.message;
    return this.items
      .map((e) => {
        const code = e.errorCode ? Object.entries(e.errorCode).map(([k, v]) => `${k}:${v}`).join(",") : "?";
        return `[${code}] ${e.message ?? ""}`;
      })
      .join("\n");
  }
}

export const MICROS = 1_000_000;
export function toMicros(amount: number): string {
  return String(Math.round(amount * MICROS));
}
export function fromMicros(micros: number | string): number {
  return Number(micros) / MICROS;
}

/** Balik Cepte'nin kendi hesap ID'sini dondurur, yoksa acik bir hata firlatir. */
export function requireCustomerId(env: GadsEnv): string {
  if (!env.GADS_CUSTOMER_ID) {
    throw new Error(
      "GADS_CUSTOMER_ID henuz ayarlanmamis - Balik Cepte'nin Google Ads hesabi olusturulup ID'si " +
        "secret olarak eklenmeden kampanya islemleri yapilamaz.",
    );
  }
  return env.GADS_CUSTOMER_ID;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(env: GadsEnv): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.GADS_CLIENT_ID,
    client_secret: env.GADS_CLIENT_SECRET,
    refresh_token: env.GADS_REFRESH_TOKEN,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Google OAuth token alinamadi: ${json.error ?? res.status} ${json.error_description ?? ""} ` +
        "(refresh_token suresi dolmus olabilir - 'Testing' modunda 7 gun gecerli, README'deki OAuth akisini tekrarla).",
    );
  }

  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000 };
  return cachedToken.value;
}

async function commonHeaders(env: GadsEnv): Promise<Record<string, string>> {
  const token = await getAccessToken(env);
  return {
    Authorization: `Bearer ${token}`,
    "developer-token": env.GADS_DEVELOPER_TOKEN,
    "login-customer-id": env.GADS_LOGIN_CUSTOMER_ID,
    "Content-Type": "application/json",
  };
}

async function parseOrThrow(res: Response): Promise<any> {
  const json = (await res.json().catch(() => undefined)) as
    | { error?: { message?: string; details?: { errors?: GadsErrorItem[] }[] } }
    | undefined;
  if (!res.ok) {
    throw new GadsApiError(json, res.status);
  }
  return json;
}

/** GAQL arama - customers/{customerId}/googleAds:search */
export async function gadsSearch(env: GadsEnv, customerId: string, query: string): Promise<Record<string, unknown>[]> {
  const headers = await commonHeaders(env);
  const rows: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`${API_BASE}/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, pageToken }),
    });
    const json = await parseOrThrow(res);
    rows.push(...(json.results ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return rows;
}

/** Mutate cagrisi - customers/{customerId}/{resource}:mutate */
export async function gadsMutate(
  env: GadsEnv,
  customerId: string,
  resource: string,
  operations: unknown[],
): Promise<Record<string, unknown>[]> {
  const headers = await commonHeaders(env);
  const res = await fetch(`${API_BASE}/customers/${customerId}/${resource}:mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ operations }),
  });
  const json = await parseOrThrow(res);
  return json.results ?? [];
}

/** Kimlik dogrulamayi test etmek icin - erisilebilir hesap listesini doner. Basic Access gerektirmez. */
export async function listAccessibleCustomers(env: GadsEnv): Promise<string[]> {
  const headers = await commonHeaders(env);
  const res = await fetch(`${API_BASE}/customers:listAccessibleCustomers`, { headers });
  const json = await parseOrThrow(res);
  return json.resourceNames ?? [];
}
