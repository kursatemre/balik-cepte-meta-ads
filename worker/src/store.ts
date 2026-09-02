/**
 * Kalici gorsel deposu (Cloudflare R2). Python CLI'daki yerel `creatives/`
 * klasorunun uzaktan erisilebilir karsiligi - Claude bir gorseli bir kere
 * buraya yukler, sonra campaign_create'de `images: [{ key: "..." }]` ile
 * tekrar tekrar referans verebilir.
 */

export interface StoredCreative {
  key: string;
  size: number;
  uploaded: string; // ISO 8601
  contentType?: string;
}

export async function listCreatives(bucket: R2Bucket): Promise<StoredCreative[]> {
  const result = await bucket.list();
  return result.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    contentType: obj.httpMetadata?.contentType,
  }));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function uploadCreativeFromBase64(
  bucket: R2Bucket,
  key: string,
  base64: string,
  contentType?: string,
): Promise<void> {
  await bucket.put(key, base64ToArrayBuffer(base64), {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

export async function uploadCreativeFromUrl(bucket: R2Bucket, key: string, url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gorsel URL'den indirilemedi (HTTP ${res.status}): ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? undefined;
  await bucket.put(key, await res.arrayBuffer(), {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

export async function deleteCreative(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Depodan bir gorseli base64 olarak okur - Meta'ya yuklerken kullanilir. */
export async function readCreativeAsBase64(bucket: R2Bucket, key: string): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(
      `Depoda '${key}' adinda bir gorsel bulunamadi. creative_store_list ile mevcut anahtarlari gor ya da once creative_store_upload/creative_store_upload_from_url ile yukle.`,
    );
  }
  return arrayBufferToBase64(await obj.arrayBuffer());
}
