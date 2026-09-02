/** Hesap/baglanti dogrulama - Basic Access onaylanmadan da calisir. */
import { listAccessibleCustomers, type GadsEnv } from "./client";

export async function getOrgInfo(env: GadsEnv): Promise<Record<string, unknown>> {
  const resourceNames = await listAccessibleCustomers(env);
  return {
    login_customer_id: env.GADS_LOGIN_CUSTOMER_ID,
    balik_cepte_customer_id: env.GADS_CUSTOMER_ID ?? null,
    accessible_customers: resourceNames,
    note: env.GADS_CUSTOMER_ID
      ? undefined
      : "GADS_CUSTOMER_ID henuz ayarlanmamis - Balik Cepte hesabi olusturulup ID eklenmeden kampanya islemleri yapilamaz.",
  };
}
