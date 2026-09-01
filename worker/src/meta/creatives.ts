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
import { adAccountPath, graphRequest, type MetaEnv } from "./client";

const DEFAULT_CTA_TYPE = "LEARN_MORE";
const CAROUSEL_MIN_CARDS = 2;
const CAROUSEL_MAX_CARDS = 10;

export type ImageInput = { url: string } | { base64: string };

function isUrlInput(image: ImageInput): image is { url: string } {
  return "url" in image;
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

/** Bir gorseli (URL'den indirip ya da dogrudan base64 verilerek) Meta'ya yukler, image_hash doner. */
export async function uploadImage(env: MetaEnv, image: ImageInput): Promise<string> {
  let bytes: string;
  if (isUrlInput(image)) {
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
