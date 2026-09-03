/**
 * Depodaki (R2) bir gorsel/videoyu herkese acik (auth'suz) servis eder.
 *
 * Neden gerekli: Meta'nin video yukleme ucu (`/advideos`) buyuk dosyalar
 * icin base64 degil, ya gercek multipart binary ya da Meta'nin kendisinin
 * fetch edecegi bir `file_url` bekliyor. R2'deki bir dosyayi Meta'ya
 * `file_url` olarak vermek icin o dosyanin herkese acik bir URL'den
 * erisilebilir olmasi lazim - istemeden Meta'nin (ya da baskasinin) bu
 * dosyalara erisebilecegi anlamina gelir, ama bunlar zaten reklam
 * kreatifleri (pazarlama gorseli/videosu) - gizli veri degil, bu yuzden
 * auth gerektirmeden servis etmek kabul edilebilir bir risk.
 */
import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/:key", async (c) => {
  const key = c.req.param("key");
  const obj = await c.env.CREATIVES.get(key);
  if (!obj) {
    return c.text("Bulunamadi", 404);
  }
  const headers = new Headers();
  if (obj.httpMetadata?.contentType) {
    headers.set("Content-Type", obj.httpMetadata.contentType);
  }
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(obj.body, { headers });
});

export { app as AssetsHandler };
