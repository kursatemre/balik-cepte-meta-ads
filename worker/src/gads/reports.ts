/** Google Ads performans raporlama (GAQL). */
import { fromMicros, gadsSearch, requireCustomerId, type GadsEnv } from "./client";

export type GadsReportLevel = "campaign" | "adgroup" | "keyword";

export interface GadsReportQuery {
  level: GadsReportLevel;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  campaignId?: string;
  adGroupId?: string;
}

const METRICS = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr";

function buildQuery(q: GadsReportQuery): string {
  const dateFilter = `segments.date BETWEEN '${q.since}' AND '${q.until}'`;
  if (q.level === "campaign") {
    return `SELECT campaign.id, campaign.name, ${METRICS} FROM campaign WHERE ${dateFilter}`;
  }
  if (q.level === "adgroup") {
    const scope = q.campaignId ? ` AND campaign.id = ${Number(q.campaignId)}` : "";
    return `SELECT ad_group.id, ad_group.name, campaign.id, ${METRICS} FROM ad_group WHERE ${dateFilter}${scope}`;
  }
  const scope = q.adGroupId ? ` AND ad_group.id = ${Number(q.adGroupId)}` : "";
  return (
    "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, " +
    `${METRICS} FROM keyword_view WHERE ${dateFilter}${scope}`
  );
}

export async function getReport(env: GadsEnv, q: GadsReportQuery): Promise<Record<string, unknown>[]> {
  const customerId = requireCustomerId(env);
  const rows = await gadsSearch(env, customerId, buildQuery(q));
  return rows.map((r: any) => ({
    ...r,
    metrics: r.metrics
      ? {
          ...r.metrics,
          cost: r.metrics.costMicros ? fromMicros(r.metrics.costMicros) : 0,
        }
      : undefined,
  }));
}
