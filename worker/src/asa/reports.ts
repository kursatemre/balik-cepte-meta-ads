/**
 * ASA performans raporlama. Tam alan gereksinimleri bu oturumda canli test
 * edilerek dogrulanmadi - ilk gercek cagrida donen hata mesajina gore
 * (AsaApiError) gerekirse payload guncellenmeli.
 */
import { asaRequest, type AsaEnv } from "./client";

export type AsaReportLevel = "campaign" | "adgroup" | "keyword";

export interface AsaReportQuery {
  level: AsaReportLevel;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  campaignId?: string; // adgroup/keyword icin gerekli
  adGroupId?: string; // keyword icin gerekli
  limit?: number;
}

function pathFor(q: AsaReportQuery): string {
  if (q.level === "campaign") return "/reports/campaigns";
  if (q.level === "adgroup") {
    if (!q.campaignId) throw new Error("adgroup raporu icin campaign_id gerekli.");
    return `/reports/campaigns/${q.campaignId}/adgroups`;
  }
  if (!q.campaignId || !q.adGroupId) throw new Error("keyword raporu icin campaign_id ve adgroup_id gerekli.");
  return `/reports/campaigns/${q.campaignId}/adgroups/${q.adGroupId}/keywords`;
}

export async function getReport(env: AsaEnv, q: AsaReportQuery): Promise<unknown> {
  const body = {
    startTime: q.since,
    endTime: q.until,
    selector: {
      orderBy: [{ field: "countryOrRegion", sortOrder: "ASCENDING" }],
      pagination: { offset: 0, limit: q.limit ?? 100 },
    },
    groupBy: ["countryOrRegion"],
    timeZone: "ORTZ",
    returnRowTotals: true,
    returnRecordsWithNoMetrics: false,
  };
  const result = await asaRequest(env, pathFor(q), { method: "POST", body });
  return result.data ?? result;
}
