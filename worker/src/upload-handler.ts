/**
 * Mobil-dostu gorsel yukleme sayfasi.
 *
 * Asil sorunu cozer: kullanicinin telefonundaki bir gorseli, once baska bir
 * yerde barindirmasina gerek kalmadan, dogrudan bu worker'in R2 deposuna
 * koyabilmesi. `creative_store_upload_from_url` zaten herkese acik bir URL
 * gerektiriyordu (barindirma sorununu cozmuyor); Claude'un (model olarak)
 * sohbette gorduğu bir gorselin ham byte'larini harfiyen base64 olarak
 * yeniden uretmesi de mumkun degil (vision girdisi token'lardan orijinal
 * byte'lara geri cevrilemez). Bu yuzden gercek cozum: tarayicidan dogrudan
 * dosya secip yukleyen bir form.
 *
 * Basic Auth ile korunuyor (MCP_ADMIN_PASSWORD - MCP login'deki ayni parola,
 * tek kaynak). Mobil tarayicilar Basic Auth'u native destekler, ayri bir
 * cookie/session mekanizmasi kurmaya gerek yok.
 */
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const mw = basicAuth({
    verifyUser: (_username, password) => password === c.env.MCP_ADMIN_PASSWORD,
    realm: "Balık Cepte - Görsel Yükleme",
  });
  return mw(c, next);
});

function page(opts: { notice?: string; noticeIsError?: boolean } = {}): string {
  const { notice, noticeIsError } = opts;
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Balık Cepte - Görsel Yükle</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e8e8e8;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
  main { background: #1a1d24; padding: 2rem; border-radius: 12px; width: min(380px, 100%);
         box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  h1 { font-size: 1.05rem; margin: 0 0 .35rem; }
  p.sub { font-size: .82rem; color: #9aa0aa; margin: 0 0 1.25rem; }
  label { display: block; font-size: .82rem; color: #9aa0aa; margin: 0 0 .35rem; }
  input[type=text] { width: 100%; box-sizing: border-box; padding: .65rem .75rem; border-radius: 8px;
          border: 1px solid #333; background: #0f1115; color: #fff; font-size: 1rem; margin-bottom: 1rem; }
  input[type=file] { width: 100%; box-sizing: border-box; padding: .65rem 0; margin-bottom: 1.25rem; color: #e8e8e8; }
  button { width: 100%; padding: .65rem; border: 0; border-radius: 8px; background: #3b82f6;
           color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #2563eb; }
  .notice { font-size: .85rem; margin: 0 0 1rem; padding: .6rem .75rem; border-radius: 8px; }
  .notice.ok { background: #14321f; color: #4ade80; }
  .notice.err { background: #3a1616; color: #f87171; }
  .key { font-family: ui-monospace, monospace; background: #0f1115; padding: .1rem .4rem; border-radius: 4px; }
</style>
</head>
<body>
<main>
  <h1>🐟 Görsel Yükle</h1>
  <p class="sub">Yüklenen görsel Claude'da <span class="key">creative_store_list</span> ile görünür, kampanyalarda <span class="key">{"key": "..."}</span> ile kullanılır.</p>
  ${notice ? `<div class="notice ${noticeIsError ? "err" : "ok"}">${notice}</div>` : ""}
  <form method="POST" enctype="multipart/form-data">
    <label for="file">Görsel</label>
    <input type="file" id="file" name="file" accept="image/*" required>
    <label for="key">Anahtar (boş bırakırsan dosya adı kullanılır)</label>
    <input type="text" id="key" name="key" placeholder="kart1.jpg">
    <button type="submit">Yükle</button>
  </form>
</main>
</body>
</html>`;
}

app.get("/", (c) => c.html(page()));

app.post("/", async (c) => {
  const formData = await c.req.raw.formData();
  const file = formData.get("file");
  const keyField = formData.get("key");

  if (!(file instanceof File) || file.size === 0) {
    return c.html(page({ notice: "Dosya seçilmedi ya da boş.", noticeIsError: true }), 400);
  }

  const key = typeof keyField === "string" && keyField.trim() ? keyField.trim() : file.name;

  await c.env.CREATIVES.put(key, await file.arrayBuffer(), {
    httpMetadata: file.type ? { contentType: file.type } : undefined,
  });

  const sizeKb = (file.size / 1024).toFixed(1);
  return c.html(
    page({
      notice: `Yüklendi: <span class="key">${key}</span> (${sizeKb} KB). Claude'a "creative_store_list ile kontrol et" diyebilirsin.`,
    }),
  );
});

export { app as UploadHandler };
