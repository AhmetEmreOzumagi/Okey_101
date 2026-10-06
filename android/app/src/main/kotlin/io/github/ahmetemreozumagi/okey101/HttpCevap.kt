package io.github.ahmetemreozumagi.okey101

import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/** Gönderilecek HTTP cevabı. [baytlar] ile tek seferde yazılacak bayt dizisine çevrilir. */
class HttpCevap(
    val kod: Int,
    val govde: ByteArray = ByteArray(0),
    val tur: String? = null,
    val basliklar: Map<String, String> = emptyMap(),
) {
    /**
     * Başlıklar + gövde. [gzipOlsun] true ise (istemci kabul ediyorsa) 1 KB'den büyük gövde sıkıştırılır;
     * zaten sıkıştırılmış gelen (Content-Encoding verilmiş) gövdeye dokunulmaz. [sadeceBas] HEAD istekleri için.
     */
    fun baytlar(gzipOlsun: Boolean, sadeceBas: Boolean = false): ByteArray {
        var g = govde
        val h = LinkedHashMap(basliklar)
        if (gzipOlsun && govde.size > 1024 && !h.containsKey("Content-Encoding")) {
            g = gzip(govde)
            h["Content-Encoding"] = "gzip"
        }
        val sb = StringBuilder(256)
        sb.append("HTTP/1.1 ").append(kod).append(' ').append(DURUMLAR[kod] ?: "OK").append("\r\n")
        if (tur != null) sb.append("Content-Type: ").append(tur).append("\r\n")
        sb.append("Content-Length: ").append(g.size).append("\r\n")
        for ((k, v) in h) sb.append(k).append(": ").append(v).append("\r\n")
        sb.append("Connection: close\r\n\r\n")
        val bas = sb.toString().toByteArray(Charsets.ISO_8859_1)
        return if (sadeceBas) bas else bas + g
    }

    companion object {
        val DURUMLAR = mapOf(
            200 to "OK", 302 to "Found", 304 to "Not Modified", 400 to "Bad Request", 403 to "Forbidden",
            404 to "Not Found", 405 to "Method Not Allowed", 500 to "Internal Server Error", 503 to "Service Unavailable",
        )

        fun json(kod: Int, metin: String) = HttpCevap(
            kod, metin.toByteArray(Charsets.UTF_8), "application/json; charset=utf-8", mapOf("Cache-Control" to "no-store"),
        )

        fun yonlendir(konum: String) = HttpCevap(302, basliklar = mapOf("Location" to konum))
        fun bos(kod: Int) = HttpCevap(kod)

        fun gzip(veri: ByteArray): ByteArray {
            val out = ByteArrayOutputStream(veri.size / 3 + 64)
            GZIPOutputStream(out).use { it.write(veri) }
            return out.toByteArray()
        }
    }
}
