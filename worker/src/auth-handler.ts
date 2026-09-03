/**
 * Tek kullanicili OAuth authorize ekrani.
 *
 * Harici bir identity provider (GitHub/Google) YOK - tek bir parola
 * (MCP_ADMIN_PASSWORD secret'i) kontrol edilir, dogruysa OAuthProvider'in
 * completeAuthorization()'i cagirilir. Cloudflare'in resmi GitHub-OAuth
 * demosundaki iki-hop (redirect'e git, geri don) akisinin aksine tek
 * endpoint'te (GET form goster, POST dogrula) biter - harici bir yere
 * yonlendirme olmadigi icin buna gerek yok.
 *
 * CSRF notu: Formu sahte bir sayfadan tetiklemek parolayi bilmeden ise
 * yaramaz (tarayici otomatik doldurma sadece bu sayfanin kendi origin'inde
 * calisir) - bu yuzden ayrica bir CSRF token/cookie mekanizmasi eklenmedi.
 */
import { Hono } from "hono";
import { AuthorizationError, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { UploadHandler } from "./upload-handler";
import { AssetsHandler } from "./assets-handler";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();

// /mcp disindaki her istek buraya (defaultHandler) dusuyor - /upload'i da
// burada mount ediyoruz (Basic Auth ile kendi icinde korumali).
app.route("/upload", UploadHandler);
// /assets/:key auth'suz - bkz. assets-handler.ts (Meta video yuklemesi icin gerekli).
app.route("/assets", AssetsHandler);

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function loginPage(encodedState: string, error?: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Balık Cepte Meta Ads</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e8e8e8;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { background: #1a1d24; padding: 2rem; border-radius: 12px; width: min(340px, 90vw);
         box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  h1 { font-size: 1.05rem; margin: 0 0 .35rem; }
  p.sub { font-size: .82rem; color: #9aa0aa; margin: 0 0 1.25rem; }
  input { width: 100%; box-sizing: border-box; padding: .65rem .75rem; border-radius: 8px;
          border: 1px solid #333; background: #0f1115; color: #fff; font-size: 1rem; margin-bottom: 1rem; }
  button { width: 100%; padding: .65rem; border: 0; border-radius: 8px; background: #3b82f6;
           color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #2563eb; }
  .err { color: #f87171; font-size: .85rem; margin: -.5rem 0 1rem; }
</style>
</head>
<body>
<form method="POST" action="/authorize">
  <h1>🐟 Balık Cepte Meta Ads</h1>
  <p class="sub">MCP sunucusuna erişim için parola gir.</p>
  ${error ? `<div class="err">${error}</div>` : ""}
  <input type="hidden" name="state" value="${encodedState}">
  <input type="password" name="password" placeholder="Parola" autofocus required autocomplete="current-password">
  <button type="submit">Giriş yap</button>
</form>
</body>
</html>`;
}

app.get("/authorize", async (c) => {
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (err) {
    if (!(err instanceof AuthorizationError)) throw err;
    if (!err.redirectUri) {
      return c.text(err.description, 400);
    }
    const redirect = new URL(err.redirectUri);
    redirect.searchParams.set("error", err.code);
    redirect.searchParams.set("error_description", err.description);
    if (err.state) redirect.searchParams.set("state", err.state);
    if (err.issuer) redirect.searchParams.set("iss", err.issuer);
    return Response.redirect(redirect.toString(), 302);
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) {
    return c.text("Bilinmeyen OAuth istemcisi.", 400);
  }

  const encodedState = btoa(JSON.stringify(oauthRequest));
  return htmlResponse(loginPage(encodedState));
});

app.post("/authorize", async (c) => {
  const formData = await c.req.raw.formData();
  const password = formData.get("password");
  const encodedState = formData.get("state");

  if (typeof encodedState !== "string") {
    return c.text("Geçersiz istek: state eksik.", 400);
  }

  let oauthRequest: AuthRequest;
  try {
    oauthRequest = JSON.parse(atob(encodedState));
  } catch {
    return c.text("Geçersiz durum verisi.", 400);
  }

  if (password !== c.env.MCP_ADMIN_PASSWORD) {
    return htmlResponse(loginPage(encodedState, "Yanlış parola."), 401);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: "emre",
    metadata: { label: "Balık Cepte Meta Ads" },
    scope: oauthRequest.scope,
    props: { userId: "emre" },
  });

  return Response.redirect(redirectTo, 302);
});

export { app as AuthHandler };
