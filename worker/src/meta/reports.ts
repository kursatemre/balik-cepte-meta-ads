/** Performans raporlama (insights). meta_ads/reports.py'nin portu. */
import { adAccountPath, graphRequestPaged, type MetaEnv } from "./client";

const DEFAULT_FIELDS = ["campaign_name", "impressions", "clicks", "spend", "ctr", "cpc", "actions"];

export interface InsightsQuery {
  since?: string; // YYYY-MM-DD
  until?: string; // YYYY-MM-DD
  datePreset?: string;
  breakdown?: string;
  campaignId?: string;
  fields?: string[];
}

export async function getInsights(env: MetaEnv, q: InsightsQuery): Promise<Record<string, unknown>[]> {
  const fields = q.fields ?? DEFAULT_FIELDS;
  const params: Record<string, unknown> = { fields: fields.join(",") };

  if (q.since && q.until) {
    params.time_range = { since: q.since, until: q.until };
  } else {
    params.date_preset = q.datePreset ?? "last_30d";
  }
  if (q.breakdown) params.breakdowns = [q.breakdown];

  const path = q.campaignId ? `/${q.campaignId}/insights` : adAccountPath(env, "insights");
  return await graphRequestPaged(env, path, params);
}
