/** Performans raporlama (insights). meta_ads/reports.py'nin portu. */
import { adAccountPath, graphRequestPaged, type MetaEnv } from "./client";

const BASE_FIELDS = ["impressions", "clicks", "spend", "ctr", "cpc", "actions"];

export type InsightsLevel = "campaign" | "adset" | "ad";

export interface InsightsQuery {
  since?: string; // YYYY-MM-DD
  until?: string; // YYYY-MM-DD
  datePreset?: string;
  breakdown?: string;
  campaignId?: string;
  /** Kirilim seviyesi - varsayilan "campaign". "adset"/"ad" verilirse ilgili ad/adset adi da eklenir. */
  level?: InsightsLevel;
  fields?: string[];
}

function defaultFieldsFor(level: InsightsLevel): string[] {
  const nameField = level === "ad" ? "ad_name" : level === "adset" ? "adset_name" : "campaign_name";
  return ["campaign_name", nameField, ...BASE_FIELDS].filter((f, i, arr) => arr.indexOf(f) === i);
}

export async function getInsights(env: MetaEnv, q: InsightsQuery): Promise<Record<string, unknown>[]> {
  const level = q.level ?? "campaign";
  const fields = q.fields ?? defaultFieldsFor(level);
  const params: Record<string, unknown> = { fields: fields.join(","), level };

  if (q.since && q.until) {
    params.time_range = { since: q.since, until: q.until };
  } else {
    params.date_preset = q.datePreset ?? "last_30d";
  }
  if (q.breakdown) params.breakdowns = [q.breakdown];

  const path = q.campaignId ? `/${q.campaignId}/insights` : adAccountPath(env, "insights");
  return await graphRequestPaged(env, path, params);
}
