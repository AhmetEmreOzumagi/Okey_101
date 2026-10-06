package io.github.ahmetemreozumagi.okey101

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder

/** Ayrıştırılmış HTTP isteği. Oyunun ihtiyacı kadar: istek satırı, başlıklar, Content-Length'li gövde. */
class HttpIstek(val metod: String, val hedef: String, val basliklar: Map<String, String>, val govde: ByteArray) {
    /** Sorgu kısmı atılmış yol, örn. "/state" */
    val yol: String
    /** ?token=... gibi sorgu parametreleri (URL çözümlenmiş) */
    val sorgu: Map<String, String>

    init {
        val i = hedef.indexOf('?')
        yol = if (i >= 0) hedef.substring(0, i) else hedef
        sorgu = if (i >= 0) sorguAyir(hedef.substring(i + 1)) else emptyMap()
    }

    /** Başlık adı büyük/küçük harfe duyarsız */
    fun baslik(ad: String): String? = basliklar[ad.lowercase()]
    val gzipKabul: Boolean get() = baslik("accept-encoding")?.contains("gzip") == true
    fun govdeMetni(): String = String(govde, Charsets.UTF_8)

    companion object {
        const val EN_BUYUK_GOVDE = 65536

        /** Akıştan bir istek okur. Bağlantı hiç veri gelmeden kapandıysa null; bozuk istekte IOException. */
        @Throws(IOException::class)
        fun oku(giris: InputStream): HttpIstek? {
            var satir = satirOku(giris) ?: return null
            if (satir.isEmpty()) satir = satirOku(giris) ?: return null // istek öncesi boş satırı atla
            val parcalar = satir.split(' ')
            if (parcalar.size < 2 || parcalar[0].isEmpty()) throw IOException("Bozuk istek satırı")
            val metod = parcalar[0].uppercase()
            val hedef = parcalar[1]
            val basliklar = HashMap<String, String>()
            while (true) {
                val b = satirOku(giris) ?: throw IOException("Başlıklar yarım kaldı")
                if (b.isEmpty()) break
                val k = b.indexOf(':')
                if (k <= 0) continue
                basliklar[b.substring(0, k).trim().lowercase()] = b.substring(k + 1).trim()
                if (basliklar.size > 100) throw IOException("Çok fazla başlık")
            }
            val uzunluk = basliklar["content-length"]?.trim()?.toIntOrNull() ?: 0
            if (uzunluk < 0 || uzunluk > EN_BUYUK_GOVDE) throw IOException("Gövde çok büyük")
            val govde = ByteArray(uzunluk)
            var okunan = 0
            while (okunan < uzunluk) {
                val n = giris.read(govde, okunan, uzunluk - okunan)
                if (n < 0) throw IOException("Gövde yarım kaldı")
                okunan += n
            }
            return HttpIstek(metod, hedef, basliklar, govde)
        }

        /** CRLF (ya da LF) ile biten bir satırı okur; akış hiç veri vermeden bittiyse null. */
        @Throws(IOException::class)
        fun satirOku(giris: InputStream): String? {
            val buf = ByteArrayOutputStream(128)
            while (true) {
                val c = giris.read()
                if (c < 0) return if (buf.size() == 0) null else buf.toString("UTF-8")
                if (c == '\n'.code) break
                if (c != '\r'.code) buf.write(c)
                if (buf.size() > 8192) throw IOException("Satır çok uzun")
            }
            return buf.toString("UTF-8")
        }

        /** "a=1&b=x%20y" → {a: "1", b: "x y"} */
        fun sorguAyir(s: String): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for (p in s.split('&')) {
                if (p.isEmpty()) continue
                val e = p.indexOf('=')
                val k = coz(if (e >= 0) p.substring(0, e) else p)
                val v = if (e >= 0) coz(p.substring(e + 1)) else ""
                out[k] = v
            }
            return out
        }

        private fun coz(s: String): String = try {
            URLDecoder.decode(s, "UTF-8")
        } catch (e: Exception) {
            s
        }
    }
}
