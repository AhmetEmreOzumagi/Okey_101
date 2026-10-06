package io.github.ahmetemreozumagi.okey101

import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Telefondaki küçük HTTP sunucusu. server.js ile aynı uç noktaları sunar, böylece public/ arayüzü
 * hiç değişmeden çalışır:
 *   GET /            tek sayfa (css ve js gömülü, gzip'li, ETag'li)
 *   GET /state       o telefonun görünümü (yoklama)
 *   GET /events      SSE: anlık güncellemeler, 10 sn'de bir ping
 *   POST /api        hamleler ve lobi işlemleri
 *   GET /ping        "bu bir 101 Okey masası" cevabı (ağ taraması için)
 *   GET /<dosya>     public/ içindeki dosyalar (icon.png); bilinmeyen adres → /
 * Oyun kuralları burada değil: dinamik istekler [Isleyici] üzerinden JS çekirdeğine gider.
 */
class HttpSunucu(private val isleyici: Isleyici) {
    interface Isleyici {
        fun sayfa(): Sayfa
        fun statik(ad: String): HttpCevap?
        fun state(token: String, ip: String): HttpCevap
        fun api(govde: String, ip: String): HttpCevap
        fun ping(): HttpCevap
        /** Yeni canlı bağlantı açıldı; ilk görünüm [sseGonder] ile gönderilmeli */
        fun sseAcildi(id: Int, token: String, ip: String)
        fun sseKapandi(id: Int)
    }

    @Volatile
    var port = 0
        private set
    private var soket: ServerSocket? = null
    private val havuz: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "okey-http").apply { isDaemon = true } }
    private val sseler = ConcurrentHashMap<Int, SseBaglanti>()
    private val sseSayac = AtomicInteger(0)
    @Volatile
    private var calisiyor = false

    val sseSayisi: Int get() = sseler.size

    /** Verilen aralıktaki ilk boş porta bağlanır, dinlemeye başlar, portu döndürür. */
    @Throws(IOException::class)
    fun baslat(portlar: IntRange): Int {
        var son: IOException? = null
        for (p in portlar) {
            try {
                val s = ServerSocket()
                s.reuseAddress = true
                s.bind(InetSocketAddress(p), 50)
                soket = s
                port = p
                break
            } catch (e: IOException) {
                son = e
            }
        }
        if (soket == null) throw son ?: IOException("Boş port bulunamadı")
        calisiyor = true
        Thread({ dinle() }, "okey-dinle").apply { isDaemon = true }.start()
        return port
    }

    fun durdur() {
        calisiyor = false
        try { soket?.close() } catch (_: IOException) {}
        soket = null
        for (b in sseler.values.toList()) b.kapat(false)
        sseler.clear()
        havuz.shutdownNow()
    }

    private fun dinle() {
        val s = soket ?: return
        while (calisiyor) {
            val c = try {
                s.accept()
            } catch (e: IOException) {
                if (calisiyor) Log.w(Masa.TAG, "accept: ${e.message}")
                continue
            }
            try {
                havuz.execute { baglanti(c) }
            } catch (e: Exception) {
                try { c.close() } catch (_: IOException) {}
            }
        }
    }

    private fun baglanti(s: Socket) {
        var sse = false
        try {
            s.soTimeout = 15000
            s.tcpNoDelay = true
            val giris = BufferedInputStream(s.getInputStream(), 8192)
            val cikis = BufferedOutputStream(s.getOutputStream(), 16384)
            val istek = HttpIstek.oku(giris) ?: return
            val ip = ipOf(s)
            if (istek.metod == "GET" && istek.yol == "/events") {
                sse = true
                sseBaslat(s, giris, cikis, istek, ip)
                return
            }
            val cevap = try {
                yonlendir(istek, ip)
            } catch (e: Exception) {
                Log.e(Masa.TAG, "istek işlenemedi: ${istek.metod} ${istek.yol}", e)
                HttpCevap.json(500, "{\"ok\":false,\"error\":\"Sunucu hatası\"}")
            }
            cikis.write(cevap.baytlar(istek.gzipKabul, istek.metod == "HEAD"))
            cikis.flush()
        } catch (_: IOException) {
            // istemci bağlantıyı kapatmış ya da bozuk istek: sessizce bırak
        } finally {
            if (!sse) try { s.close() } catch (_: IOException) {}
        }
    }

    private fun yonlendir(i: HttpIstek, ip: String): HttpCevap = when {
        i.metod == "POST" && i.yol == "/api" -> isleyici.api(i.govdeMetni(), ip)
        i.metod == "GET" && i.yol == "/state" -> isleyici.state(i.sorgu["token"] ?: "", ip)
        i.metod == "GET" && i.yol == "/ping" -> isleyici.ping()
        (i.metod == "GET" || i.metod == "HEAD") && (i.yol == "/" || i.yol == "/index.html") -> sayfaCevabi(i)
        i.metod == "GET" && i.yol == "/favicon.ico" -> isleyici.statik("icon.png") ?: HttpCevap.yonlendir("/")
        i.metod == "GET" -> {
            // Sadece düz dosya adları; klasör dışına çıkılamaz. Bilinmeyen adres oyuna yönlendirilir.
            val ad = i.yol.trimStart('/')
            if (GUVENLI_AD.matches(ad)) isleyici.statik(ad) ?: HttpCevap.yonlendir("/") else HttpCevap.yonlendir("/")
        }
        else -> HttpCevap.bos(405)
    }

    private fun sayfaCevabi(i: HttpIstek): HttpCevap {
        val sayfa = isleyici.sayfa()
        if (i.baslik("if-none-match") == sayfa.etag) return HttpCevap(304, basliklar = mapOf("ETag" to sayfa.etag))
        val gz = i.gzipKabul
        val h = linkedMapOf("Cache-Control" to "no-cache", "ETag" to sayfa.etag)
        if (gz) h["Content-Encoding"] = "gzip"
        return HttpCevap(200, if (gz) sayfa.gz else sayfa.ham, "text/html; charset=utf-8", h)
    }

    // ---------- SSE ----------
    private fun sseBaslat(s: Socket, giris: InputStream, cikis: OutputStream, istek: HttpIstek, ip: String) {
        s.soTimeout = 0
        s.keepAlive = true
        val id = sseSayac.incrementAndGet()
        val b = SseBaglanti(id, s, cikis)
        val bas = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/event-stream; charset=utf-8\r\n" +
            "Cache-Control: no-cache, no-transform\r\n" +
            "Connection: keep-alive\r\n" +
            "X-Accel-Buffering: no\r\n\r\n" +
            "retry: 1000\n\n"
        try {
            cikis.write(bas.toByteArray(Charsets.ISO_8859_1))
            cikis.flush()
        } catch (e: IOException) {
            try { s.close() } catch (_: IOException) {}
            return
        }
        sseler[id] = b
        isleyici.sseAcildi(id, istek.sorgu["token"] ?: "", ip)
        // Tarayıcı SSE bağlantısında bir şey göndermez; read() ancak karşı taraf kapatınca döner.
        try {
            while (giris.read() >= 0) { /* gelen veri yok sayılır */ }
        } catch (_: IOException) {
        }
        b.kapat(true)
    }

    /** Bir canlı bağlantıya görünüm gönderir (herhangi bir iş parçacığından çağrılabilir; yazma arka planda yapılır) */
    fun sseGonder(id: Int, veri: String) {
        sseler[id]?.gonder("data: $veri\n\n")
    }

    /** Bağlantıları canlı tutar: telefon 10 sn'de bir sinyal alır, gelmezse yeniden bağlanır */
    fun ssePing() {
        for (b in sseler.values) b.gonder("event: ping\ndata: 1\n\n")
    }

    inner class SseBaglanti(val id: Int, private val soket: Socket, private val cikis: OutputStream) {
        private val acik = AtomicBoolean(true)
        // Her bağlantının kendi yazıcısı: yavaş bir telefon diğerlerini bekletmez, ana iş parçacığında ağ yazılmaz
        private val yazici = Executors.newSingleThreadExecutor { r -> Thread(r, "okey-sse-$id").apply { isDaemon = true } }

        fun gonder(metin: String) {
            if (!acik.get()) return
            try {
                yazici.execute {
                    if (!acik.get()) return@execute
                    try {
                        cikis.write(metin.toByteArray(Charsets.UTF_8))
                        cikis.flush()
                    } catch (e: IOException) {
                        kapat(true)
                    }
                }
            } catch (_: Exception) {
                // yazıcı kapanmış
            }
        }

        fun kapat(bildir: Boolean) {
            if (!acik.compareAndSet(true, false)) return
            sseler.remove(id)
            try { soket.close() } catch (_: IOException) {}
            yazici.shutdown()
            if (bildir && calisiyor) {
                try {
                    havuz.execute { isleyici.sseKapandi(id) }
                } catch (_: Exception) {
                }
            }
        }
    }

    companion object {
        private val GUVENLI_AD = Regex("[A-Za-z0-9][A-Za-z0-9._-]*")

        fun ipOf(s: Socket): String = (s.inetAddress?.hostAddress ?: "").removePrefix("::ffff:")
    }
}
