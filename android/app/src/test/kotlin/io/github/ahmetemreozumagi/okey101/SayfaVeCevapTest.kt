package io.github.ahmetemreozumagi.okey101

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.zip.GZIPInputStream

/** Tek sayfa üretimi (css/js gömme) ve HTTP cevabı biçimi */
class SayfaVeCevapTest {
    private val dosyalar = mapOf(
        "index.html" to "<html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><script src=\"engine.js\"></script><script src=\"app.js\"></script></body></html>",
        "style.css" to "body { color: red }",
        "engine.js" to "var E = 1;",
        "app.js" to "var s = '</script><b>'; // </SCRIPT",
    )
    private val oku = { ad: String -> dosyalar[ad] ?: throw IllegalArgumentException(ad) }

    @Test
    fun cssVeBetiklerSirasiylaGomulur() {
        val h = Sayfa.gom(oku("index.html"), oku)
        // server.js gibi: "</script" ne biçimde yazılmışsa yazılsın "<\/script" olur
        assertEquals("<html><head><style>body { color: red }</style></head><body><script>var E = 1;</script><script>var s = '<\\/script><b>'; // <\\/script</script></body></html>", h)
        assertFalse(h.contains("src="))
    }

    @Test
    fun etagVeGzip() {
        val s = Sayfa.kur(oku)
        assertTrue(s.etag, Regex("\"[0-9a-f]{16}\"").matches(s.etag))
        assertEquals(s.etag, Sayfa.kur(oku).etag)
        val acilmis = GZIPInputStream(s.gz.inputStream()).readBytes()
        assertTrue(acilmis.contentEquals(s.ham))
    }

    @Test
    fun icerikTurleri() {
        assertEquals("image/png", Sayfa.icerikTuru("icon.png"))
        assertEquals("application/javascript; charset=utf-8", Sayfa.icerikTuru("app.js"))
        assertEquals("application/octet-stream", Sayfa.icerikTuru("x"))
    }

    @Test
    fun jsonCevabiBicimi() {
        val c = HttpCevap.json(200, "{\"ok\":true}")
        val s = String(c.baytlar(gzipOlsun = true), Charsets.UTF_8)
        assertTrue(s.startsWith("HTTP/1.1 200 OK\r\n"))
        assertTrue(s.contains("Content-Type: application/json; charset=utf-8\r\n"))
        assertTrue(s.contains("Content-Length: 11\r\n"))
        assertTrue(s.contains("Cache-Control: no-store\r\n"))
        assertTrue(s.contains("Connection: close\r\n\r\n{\"ok\":true}"))
        assertFalse("küçük gövde sıkıştırılmaz", s.contains("Content-Encoding"))
    }

    @Test
    fun buyukGovdeIstenirseGzipOlur() {
        val metin = "x".repeat(5000)
        val c = HttpCevap.json(200, metin)
        val gz = c.baytlar(gzipOlsun = true)
        val duz = c.baytlar(gzipOlsun = false)
        assertTrue(String(gz, Charsets.ISO_8859_1).contains("Content-Encoding: gzip\r\n"))
        assertTrue(gz.size < duz.size)
        assertFalse(String(duz, Charsets.ISO_8859_1).contains("Content-Encoding"))
    }

    @Test
    fun headIcinSadeceBaslik() {
        val c = HttpCevap.json(200, "{\"a\":1}")
        val s = String(c.baytlar(gzipOlsun = false, sadeceBas = true), Charsets.UTF_8)
        assertTrue(s.endsWith("\r\n\r\n"))
        assertTrue(s.contains("Content-Length: 7"))
    }

    @Test
    fun yonlendirmeVe405() {
        val y = String(HttpCevap.yonlendir("/").baytlar(false), Charsets.UTF_8)
        assertTrue(y.startsWith("HTTP/1.1 302 Found\r\n"))
        assertTrue(y.contains("Location: /\r\n"))
        assertTrue(String(HttpCevap.bos(405).baytlar(false), Charsets.UTF_8).startsWith("HTTP/1.1 405 Method Not Allowed"))
    }
}
