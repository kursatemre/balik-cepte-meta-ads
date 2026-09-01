import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { AuthHandler } from "./auth-handler";
import { BalikCepteMcp } from "./mcp-agent";

// wrangler.jsonc'deki Durable Object binding'inin (MCP_OBJECT) sinifi disariya
// export edilmeli - Workers runtime bunu ismiyle bulur.
export { BalikCepteMcp };

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: BalikCepteMcp.serve("/mcp", { binding: "MCP_OBJECT" }),
  defaultHandler: AuthHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // MCP 2026-07-28 DCR'i CIMD lehine deprecate ediyor ama Claude'un hangisini
  // kullandigi net degil - ikisini de acik tutuyoruz (bkz. worker/README.md).
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
});
