/**
 * Custom Audience durum kontrolu - meta_ads/audiences.py'nin portu.
 *
 * Bir kitleyi kampanyada hedeflemeden once "kullanima hazir mi" sorusunu
 * yanitlar - Meta yeni olusturulan/genisleyen kitleleri belli bir boyuta
 * ulasana kadar "too small" olarak isaretler ve kampanyada kullanmaya izin
 * vermez.
 */
import { adAccountPath, graphRequest, graphRequestPaged, type MetaEnv } from "./client";

const DELIVERY_READY_CODE = 200;

export interface AudienceStatus {
  id: string;
  name: string | null;
  approxSizeLower: number | null;
  approxSizeUpper: number | null;
  operationStatus: unknown;
  deliveryStatus: { code?: number; description?: string } | null;
  ready: boolean;
}

export async function getAudienceStatus(env: MetaEnv, audienceId: string): Promise<AudienceStatus> {
  const fields = [
    "name",
    "approximate_count_lower_bound",
    "approximate_count_upper_bound",
    "operation_status",
    "delivery_status",
  ].join(",");
  const data = await graphRequest(env, `/${audienceId}`, { params: { fields } });
  const delivery = data.delivery_status ?? null;

  return {
    id: audienceId,
    name: data.name ?? null,
    approxSizeLower: data.approximate_count_lower_bound ?? null,
    approxSizeUpper: data.approximate_count_upper_bound ?? null,
    operationStatus: data.operation_status ?? null,
    deliveryStatus: delivery,
    ready: delivery?.code === DELIVERY_READY_CODE,
  };
}

export async function listAudiences(
  env: MetaEnv,
  opts: { limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const fields = [
    "id",
    "name",
    "approximate_count_lower_bound",
    "approximate_count_upper_bound",
    "delivery_status",
  ].join(",");
  return await graphRequestPaged(env, adAccountPath(env, "customaudiences"), {
    fields,
    limit: opts.limit ?? 50,
  });
}

/** Kitle hazir degilse hata firlatir - kampanya olusturmadan once cagirilir. */
export async function ensureAudienceReady(env: MetaEnv, audienceId: string): Promise<AudienceStatus> {
  const status = await getAudienceStatus(env, audienceId);
  if (!status.ready) {
    const reason = status.deliveryStatus?.description ?? "durum bilinmiyor";
    throw new Error(
      `Kitle '${status.name}' (${audienceId}) henuz kampanyada kullanima hazir degil.\n` +
        `Meta'nin sebebi: ${reason} (yaklasik boyut: ${status.approxSizeLower}).\n` +
        "Kitle dolana kadar bekle (genelde birkac saat/gun) ya da zaten hazir baska bir kitle kullan.",
    );
  }
  return status;
}
