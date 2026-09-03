/**
 * Meta Marketing (Graph) API baglantisi ve ortak hata yonetimi.
 *
 * Python CLI'daki meta_ads/client.py'nin TypeScript portu. facebook_business
 * SDK'sinin JS esdegeri olmadigi icin Graph API'ye dogrudan fetch ile gidilir.
 *
 * NOT: Bu dosyadaki bazi detaylar (is_adset_budget_sharing_enabled,
 * bid_strategy, targeting.user_os, base64 gorsel yukleme) Python tarafinda
 * 2026-09-01/02'de gercek API'ye karsi canli test edilerek bulundu - bkz.
 * meta/campaigns.ts ve meta/creatives.ts.
 */

const GRAPH_VERSION = "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaEnv {
  META_ACCESS_TOKEN: string;
  META_APP_SECRET?: string;
  META_AD_ACCOUNT_ID: string;
}

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

const HINTS: Record<number, string> = {
  190: "Access token gecersiz veya suresi dolmus. META_ACCESS_TOKEN secret'ini yenile.",
  17: "Rate limit asildi, birkac dakika bekleyip tekrar dene.",
  80004: "Reklam hesabi bazli rate limit asildi, birkac dakika bekleyip tekrar dene.",
  100: "Gecersiz parametre - asagidaki detaya bak, muhtemelen bir alan eksik/hatali.",
  200: "Yetki hatasi - token'in bu islem icin (ads_management vb.) izni olmayabilir.",
};

export class MetaApiError extends Error {
  code?: number;
  subcode?: number;
  userTitle?: string;
  userMsg?: string;

  constructor(body: GraphErrorBody) {
    const err = body.error ?? {};
    super(err.message ?? "Bilinmeyen Meta API hatasi");
    this.name = "MetaApiError";
    this.code = err.code;
    this.subcode = err.error_subcode;
    this.userTitle = err.error_user_title;
    this.userMsg = err.error_user_msg;
  }

  /** client.py'deki MetaApiError._format()'in karsiligi - kullaniciya gosterilecek tam metin. */
  format(): string {
    const codePart = `[${this.code ?? "?"}${this.subcode ? "/" + this.subcode : ""}]`;
    let out = `Meta API hatasi ${codePart}: ${this.message}`;
    if (this.userTitle || this.userMsg) {
      const detail = [this.userTitle, this.userMsg].filter(Boolean).join(" - ");
      out += `\nDetay: ${detail}`;
    }
    const hint = this.code ? HINTS[this.code] : undefined;
    if (hint) out += `\nIpucu: ${hint}`;
    return out;
  }
}

async function appsecretProof(accessToken: string, appSecret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(accessToken));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeParams(params: Record<string, unknown> | undefined): URLSearchParams {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    usp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return usp;
}

interface GraphRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, unknown>;
}

/** Tek bir Graph API cagrisi yapar, hata varsa MetaApiError firlatir. */
export async function graphRequest(
  env: MetaEnv,
  path: string,
  opts: GraphRequestOptions = {},
): Promise<any> {
  const method = opts.method ?? "GET";
  const params = encodeParams(opts.params);
  params.set("access_token", env.META_ACCESS_TOKEN);
  if (env.META_APP_SECRET) {
    params.set("appsecret_proof", await appsecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET));
  }

  let url = `${GRAPH_BASE}${path}`;
  const init: RequestInit = { method };
  if (method === "GET" || method === "DELETE") {
    url += `?${params.toString()}`;
  } else {
    init.body = params.toString();
    init.headers = { "content-type": "application/x-www-form-urlencoded" };
  }

  const res = await fetch(url, init);
  const json = (await res.json()) as any;
  if (!res.ok || json?.error) {
    throw new MetaApiError(json);
  }
  return json;
}

/**
 * Multipart/form-data istek (binary dosya icerir) - graphRequest'in
 * form-urlencoded gonderisinden farkli. Video base64 yuklemesi gibi ham
 * byte gonderilmesi gereken durumlar icin (bkz. meta/creatives.ts).
 */
export async function graphRequestMultipart(
  env: MetaEnv,
  path: string,
  fields: Record<string, string>,
  file: { name: string; blob: Blob },
): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("access_token", env.META_ACCESS_TOKEN);
  if (env.META_APP_SECRET) {
    form.append("appsecret_proof", await appsecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET));
  }
  form.append("source", file.blob, file.name);

  const res = await fetch(`${GRAPH_BASE}${path}`, { method: "POST", body: form });
  const json = (await res.json()) as any;
  if (!res.ok || json?.error) {
    throw new MetaApiError(json);
  }
  return json;
}

/** paging.next'i takip ederek tum sayfalari toplar (rapor gibi cok satirli sonuclar icin). */
export async function graphRequestPaged(
  env: MetaEnv,
  path: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const usp = encodeParams(params);
  usp.set("access_token", env.META_ACCESS_TOKEN);
  if (env.META_APP_SECRET) {
    usp.set("appsecret_proof", await appsecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET));
  }

  let next: string | undefined = `${GRAPH_BASE}${path}?${usp.toString()}`;
  const rows: Record<string, unknown>[] = [];
  while (next) {
    const res = await fetch(next);
    const json = (await res.json()) as any;
    if (!res.ok || json?.error) throw new MetaApiError(json);
    rows.push(...(json.data ?? []));
    next = json.paging?.next;
  }
  return rows;
}

export function adAccountPath(env: MetaEnv, edge: string): string {
  return `/${env.META_AD_ACCOUNT_ID}/${edge}`;
}
