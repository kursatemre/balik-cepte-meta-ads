export {};

declare global {
  interface Env {
    // Durable Object binding (McpAgent)
    MCP_OBJECT: DurableObjectNamespace;
    // workers-oauth-provider'in kullandigi KV
    OAUTH_KV: KVNamespace;
    // Kalici gorsel deposu - bkz. src/store.ts
    CREATIVES: R2Bucket;

    // Tek kullanicili giris parolasi (OAuth /authorize ekraninda kontrol edilir)
    MCP_ADMIN_PASSWORD: string;

    // Meta Marketing API - Python CLI'daki .env ile ayni degerler
    META_APP_ID: string;
    META_APP_SECRET: string;
    META_ACCESS_TOKEN: string;
    META_AD_ACCOUNT_ID: string;
    META_PAGE_ID: string;
    META_PROMOTED_APP_ID: string;
    META_APP_STORE_URL: string;

    // Apple Search Ads - bkz. src/asa/client.ts
    ASA_CLIENT_ID: string;
    ASA_TEAM_ID: string;
    ASA_KEY_ID: string;
    ASA_ORG_ID: string;
    ASA_ADAM_ID: string; // App Store numeric id (Balik Cepte)
    ASA_PRIVATE_KEY: string; // PKCS8 PEM
  }
}
