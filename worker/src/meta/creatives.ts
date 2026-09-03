/**
 * Gorsel yukleme ve reklam kreatifi (tekil / carousel) olusturma.
 * meta_ads/creatives.py'nin portu.
 *
 * Python'dan fark: Graph API'nin POST /adimages ucu SADECE `bytes` (base64)
 * ve `copy_from` kabul ediyor - dogrudan bir `url` parametresi YOK (bu
 * oturumda developers.facebook.com'dan dogrulandi). Mobilden dosya yolu
 * vermek anlamsiz oldugu icin bu modul bir URL de kabul eder, ama gercekte
 * once o URL'i kendi fetch() eder, sonra base64'e cevirip Meta'ya `bytes`
 * olarak gonderir.
 */
import { adAccountPath, graphRequest, graphRequestMultipart, type MetaEnv } from "./client";
import { readCreativeAsBase64 } from "../store";

const DEFAULT_CTA_TYPE = "LEARN_MORE";
const CAROUSEL_MIN_CARDS = 2;
const CAROUSEL_MAX_CARDS = 10;

// Bu worker'in sabit deploy adresi - /assets/:key ile depodaki (R2) dosyalari
// Meta'nin kendisinin fetch edebilecegi bir URL'e cevirmek icin kullanilir
// (video yuklemede base64'ten cok daha verimli - buyuk dosyalarda sart).
const PUBLIC_BASE_URL = "https://balik-cepte-meta-ads-mcp.balikcepte.workers.dev";

/** `key`: creative_store_upload* ile depoya (R2) kaydedilmis bir gorsele referans. */
export type ImageInput = { url: string } | { base64: string } | { key: string };

function isUrlInput(image: ImageInput): image is { url: string } {
  return "url" in image;
}

function isKeyInput(image: ImageInput): image is { key: string } {
  return "key" in image;
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

/** Bir gorseli (URL'den, depodan (R2) ya da dogrudan base64 verilerek) Meta'ya yukler, image_hash doner. */
export async function uploadImage(
  env: MetaEnv & { CREATIVES?: R2Bucket },
  image: ImageInput,
): Promise<string> {
  let bytes: string;
  if (isKeyInput(image)) {
    if (!env.CREATIVES) {
      throw new Error("Depolama (R2) bu ortamda yapilandirilmamis - CREATIVES binding eksik.");
    }
    bytes = await readCreativeAsBase64(env.CREATIVES, image.key);
  } else if (isUrlInput(image)) {
    const res = await fetch(image.url);
    if (!res.ok) {
      throw new Error(`Gorsel URL'den indirilemedi (HTTP ${res.status}): ${image.url}`);
    }
    bytes = arrayBufferToBase64(await res.arrayBuffer());
  } else {
    bytes = image.base64;
  }

  const result = await graphRequest(env, adAccountPath(env, "adimages"), {
    method: "POST",
    params: { bytes },
  });

  // Olasi sekil 1: dogrudan hash alani olan bir obje (AdImage).
  if (typeof result?.hash === "string") return result.hash;

  // Olasi sekil 2: {"images": {"<filename>": {"hash": ..., "url": ...}}}
  if (result?.images) {
    const first = Object.values(result.images)[0] as { hash?: string } | undefined;
    if (first?.hash) return first.hash;
  }

  throw new Error(
    `Gorsel yuklendi ama yanittan image_hash cikarilamadi. Ham yanit: ${JSON.stringify(result)}`,
  );
}

export function buildSingleImageCreative(opts: {
  pageId: string;
  link: string;
  imageHash: string;
  message: string;
  headline: string;
  ctaType?: string;
}) {
  return {
    object_story_spec: {
      page_id: opts.pageId,
      link_data: {
        message: opts.message,
        link: opts.link,
        image_hash: opts.imageHash,
        name: opts.headline,
        call_to_action: { type: opts.ctaType ?? DEFAULT_CTA_TYPE, value: { link: opts.link } },
      },
    },
  };
}

export interface CarouselCard {
  image_hash: string;
  name?: string;
  description?: string;
}

export function buildCarouselCreative(opts: {
  pageId: string;
  link: string;
  message: string;
  cards: CarouselCard[];
  ctaType?: string;
}) {
  if (opts.cards.length < CAROUSEL_MIN_CARDS || opts.cards.length > CAROUSEL_MAX_CARDS) {
    throw new Error(
      `Carousel ${CAROUSEL_MIN_CARDS}-${CAROUSEL_MAX_CARDS} kart arasinda olmali, ${opts.cards.length} verildi.`,
    );
  }

  const ctaType = opts.ctaType ?? DEFAULT_CTA_TYPE;
  const childAttachments = opts.cards.map((card) => ({
    link: opts.link,
    image_hash: card.image_hash,
    name: card.name ?? "",
    description: card.description ?? "",
    call_to_action: { type: ctaType, value: { link: opts.link } },
  }));

  return {
    object_story_spec: {
      page_id: opts.pageId,
      link_data: {
        message: opts.message,
        link: opts.link,
        multi_share_optimized: true,
        multi_share_end_card: true,
        child_attachments: childAttachments,
      },
    },
  };
}

/** `key`/`url` girdisini, Meta'nin (ya da baskasinin) fetch edebilecegi herkese acik bir URL'e cevirir. */
function toPublicUrl(image: ImageInput): string | null {
  if (isUrlInput(image)) return image.url;
  if (isKeyInput(image)) return `${PUBLIC_BASE_URL}/assets/${encodeURIComponent(image.key)}`;
  return null; // base64 - URL'e cevrilemez, binary yukleme gerekir.
}

/**
 * Bir videoyu Meta'ya yukler, video_id doner. `url`/`key` girdisi icin
 * Meta'ya dogrudan `file_url` verilir (Meta kendisi fetch eder - buyuk
 * dosyalarda base64'ten cok daha verimli, Worker'in istek/yanit boyut
 * sinirina takilmaz). `base64` girdisi icin gercek multipart binary yukleme
 * yapilir (bkz. client.ts:graphRequestMultipart).
 */
export async function uploadVideo(env: MetaEnv, video: ImageInput): Promise<string> {
  const publicUrl = toPublicUrl(video);
  let result: any;
  if (publicUrl) {
    result = await graphRequest(env, adAccountPath(env, "advideos"), {
      method: "POST",
      params: { file_url: publicUrl },
    });
  } else if ("base64" in video) {
    const binary = atob(video.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    result = await graphRequestMultipart(env, adAccountPath(env, "advideos"), {}, {
      name: "video.mp4",
      blob: new Blob([bytes]),
    });
  } else {
    throw new Error("Gecersiz video girdisi.");
  }

  const videoId = result?.id;
  if (!videoId) {
    throw new Error(`Video yuklendi ama id donmedi. Ham yanit: ${JSON.stringify(result)}`);
  }
  return videoId;
}

const VIDEO_READY_POLL_INTERVAL_MS = 4000;
const VIDEO_READY_POLL_MAX_ATTEMPTS = 12; // ~48sn

/**
 * Meta videoyu yukledikten sonra arka planda isler - creative olusturmadan
 * once "ready" durumuna gelmesini bekler. Islenmeden creative olusturulursa
 * gecici/anlasilmaz bir hata alinir.
 *
 * DIKKAT (bu oturumda canli test edilerek bulundu): video_data icin
 * image_hash/image_url (kapak karesi) ZORUNLU - Meta otomatik secmiyor.
 * "ready" olunca video nesnesinin kendi `picture` alani (Meta'nin otomatik
 * urettigi kapak karesi URL'i) fallback thumbnail olarak dondurulur, boylece
 * kullanicinin ayrica thumbnail vermesine gerek kalmaz.
 */
export async function waitForVideoReady(env: MetaEnv, videoId: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < VIDEO_READY_POLL_MAX_ATTEMPTS; attempt++) {
    const result = await graphRequest(env, `/${videoId}`, { params: { fields: "status,picture" } });
    const videoStatus = result?.status?.video_status;
    if (videoStatus === "ready") return result?.picture as string | undefined;
    if (videoStatus === "error") {
      throw new Error(`Video islenirken hata olustu (Meta tarafinda): ${JSON.stringify(result?.status)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_READY_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Video ${VIDEO_READY_POLL_MAX_ATTEMPTS * VIDEO_READY_POLL_INTERVAL_MS / 1000}sn icinde "ready" durumuna gelmedi ` +
      "(hala isleniyor olabilir - Meta Ads Manager'dan durumunu kontrol et, birkac dakika sonra tekrar dene).",
  );
}

export function buildVideoCreative(opts: {
  pageId: string;
  link: string;
  videoId: string;
  thumbnailUrl?: string;
  thumbnailHash?: string;
  headline: string;
  message: string;
  ctaType?: string;
}) {
  const videoData: Record<string, unknown> = {
    video_id: opts.videoId,
    title: opts.headline,
    message: opts.message,
    call_to_action: { type: opts.ctaType ?? DEFAULT_CTA_TYPE, value: { link: opts.link } },
  };
  // Meta bir kapak karesi (image_hash ya da image_url) ZORUNLU kiliyor - bu
  // oturumda canli test edilerek bulundu, otomatik secmiyor.
  if (opts.thumbnailHash) {
    videoData.image_hash = opts.thumbnailHash;
  } else if (opts.thumbnailUrl) {
    videoData.image_url = opts.thumbnailUrl;
  }

  return {
    object_story_spec: {
      page_id: opts.pageId,
      video_data: videoData,
    },
  };
}

export interface CreativeSpec {
  creativeType: "single" | "carousel" | "video";
  images?: ImageInput[];
  video?: ImageInput;
  thumbnail?: ImageInput;
  headlines: string[];
  descriptions?: string[];
  message?: string;
  link: string;
  pageId: string;
}

/**
 * Kreatif tipi ne olursa olsun (tekil gorsel / carousel / video) dogru
 * yukleme + payload olusturmayi tek yerde toplar - campaign_create ve
 * ad_create (mevcut bir ad set'e yeni reklam ekleme) tarafindan reuse
 * edilir.
 */
export async function buildCreativeForType(
  env: MetaEnv & { CREATIVES?: R2Bucket },
  spec: CreativeSpec,
): Promise<Record<string, unknown>> {
  if (spec.creativeType === "video") {
    if (!spec.video) throw new Error("Video kreatif icin 'video' alani gerekli.");
    const videoId = await uploadVideo(env, spec.video);
    const autoThumbnailUrl = await waitForVideoReady(env, videoId);

    // Kullanici thumbnail verdiyse o kullanilir (url/key -> image_url,
    // base64 -> once ad-image olarak yuklenip image_hash olarak kullanilir),
    // yoksa Meta'nin videodan otomatik urettigi kapak karesine
    // (autoThumbnailUrl) dusulur. video_data icin bir kapak karesi ZORUNLU
    // (bu oturumda canli test edilerek bulundu).
    let thumbnailUrl: string | undefined;
    let thumbnailHash: string | undefined;
    if (spec.thumbnail) {
      const publicUrl = toPublicUrl(spec.thumbnail);
      if (publicUrl) {
        thumbnailUrl = publicUrl;
      } else {
        thumbnailHash = await uploadImage(env, spec.thumbnail);
      }
    } else {
      thumbnailUrl = autoThumbnailUrl;
    }

    return buildVideoCreative({
      pageId: spec.pageId,
      link: spec.link,
      videoId,
      thumbnailUrl,
      thumbnailHash,
      headline: spec.headlines[0] ?? "",
      message: spec.message ?? "",
    });
  }

  if (!spec.images || spec.images.length === 0) {
    throw new Error(`${spec.creativeType} kreatif icin en az 1 gorsel gerekli.`);
  }
  if (spec.creativeType === "single" && spec.images.length !== 1) {
    throw new Error("Tekil (single) kreatif icin tam olarak 1 gorsel gerekli.");
  }
  if (spec.creativeType === "carousel" && spec.headlines.length !== spec.images.length) {
    throw new Error("Carousel'de her gorsel icin bir headline gerekli (sayilar esit degil).");
  }

  // Sirali yukleniyor (Meta rate limit'ine ani yuklenmeyi onlemek icin paralel degil).
  const imageHashes: string[] = [];
  for (const image of spec.images) {
    imageHashes.push(await uploadImage(env, image));
  }

  if (spec.creativeType === "single") {
    return buildSingleImageCreative({
      pageId: spec.pageId,
      link: spec.link,
      imageHash: imageHashes[0],
      message: spec.message ?? "",
      headline: spec.headlines[0],
    });
  }

  const descs = spec.descriptions ?? spec.images.map(() => "");
  const cards = imageHashes.map((hash, i) => ({
    image_hash: hash,
    name: spec.headlines[i],
    description: descs[i] ?? "",
  }));
  return buildCarouselCreative({ pageId: spec.pageId, link: spec.link, message: spec.message ?? "", cards });
}
