/** Hesap/org bilgisi - debug ve orgId dogrulama icin. */
import { asaRequest, type AsaEnv } from "./client";

export async function getAcls(env: AsaEnv): Promise<unknown> {
  const result = await asaRequest(env, "/acls");
  return result.data ?? result;
}
