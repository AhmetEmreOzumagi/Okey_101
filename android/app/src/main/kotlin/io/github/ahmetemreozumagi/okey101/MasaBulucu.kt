package io.github.ahmetemreozumagi.okey101

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.URL
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Aynı ağda masa kurmuş telefonları bulur.
 *   1. NSD/mDNS: masa kuran telefon kendini _okey101._tcp olarak duyurur, burada dinlenir.
 *   2. Yedek: NSD çalışmıyorsa (bazı yönlendiriciler çok noktaya yayını engeller) alt ağdaki
 *      adresler 8101 portunda /ping ile taranır.
 * Bulunanlar [dinleyici] ile (ana iş parçacığında) bildirilir.
 */
class MasaBulucu(ctx: Context, private val dinleyici: (List<Bulunan>) -> Unit) {
    class Bulunan(val ad: String, val host: String, val port: Int, val kaynak: String) {
        val url: String get() = "http://$host:$port"
    }

    private val app = ctx.applicationContext
    private val nsd = app.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val ana = Handler(Looper.getMainLooper())
    private val bulunanlar = LinkedHashMap<String, Bulunan>() // url -> masa
    private var kesif: NsdManager.DiscoveryListener? = null
    private var kilit: WifiManager.MulticastLock? = null
    private val cozumKuyrugu = ArrayDeque<NsdServiceInfo>()
    private var cozuluyor = false
    @Volatile
    private var taraniyor = false
    @Volatile
    private var acik = false

    fun basla() {
        if (acik) return
        acik = true
        try {
            val wifi = app.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            kilit = wifi?.createMulticastLock("okey101")?.apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {
        }
        val d = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(tip: String) {}
            override fun onStartDiscoveryFailed(tip: String, hata: Int) {
                Log.w(Masa.TAG, "NSD araması başlamadı: $hata")
            }
            override fun onStopDiscoveryFailed(tip: String, hata: Int) {}
            override fun onDiscoveryStopped(tip: String) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                if (!info.serviceType.startsWith("_okey101.")) return
                ana.post { coz(info) }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                ana.post {
                    val onceki = bulunanlar.size
                    bulunanlar.values.removeAll { it.kaynak == "nsd" && it.ad == info.serviceName }
                    if (bulunanlar.size != onceki) bildir()
                }
            }
        }
        kesif = d
        try {
            nsd.discoverServices(Masa.SERVIS_TIPI, NsdManager.PROTOCOL_DNS_SD, d)
        } catch (e: Exception) {
            Log.w(Masa.TAG, "NSD araması olmadı", e)
        }
    }

    fun dur() {
        if (!acik) return
        acik = false
        kesif?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
        kesif = null
        try { kilit?.release() } catch (_: Exception) {}
        kilit = null
        cozumKuyrugu.clear()
        cozuluyor = false
    }

    val liste: List<Bulunan> get() = bulunanlar.values.toList()

    // Çözümlemeler sırayla yapılır: NsdManager aynı anda ikinci çözümlemeyi reddeder
    private fun coz(info: NsdServiceInfo) {
        cozumKuyrugu.add(info)
        sonrakiCoz()
    }

    private fun sonrakiCoz() {
        if (cozuluyor || !acik) return
        val info = cozumKuyrugu.poll() ?: return
        cozuluyor = true
        val bitti = { ana.post { cozuluyor = false; sonrakiCoz() } }
        try {
            @Suppress("DEPRECATION")
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(i: NsdServiceInfo, hata: Int) {
                    bitti()
                }

                override fun onServiceResolved(i: NsdServiceInfo) {
                    val host = ipv4(i)
                    if (host != null && i.port > 0) {
                        ana.post {
                            ekle(Bulunan(i.serviceName, host, i.port, "nsd"))
                        }
                    }
                    bitti()
                }
            })
        } catch (e: Exception) {
            bitti()
        }
    }

    private fun ipv4(i: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= 34) {
            i.hostAddresses.firstOrNull { it is Inet4Address }?.hostAddress?.let { return it }
        }
        @Suppress("DEPRECATION")
        val h = i.host
        return if (h is Inet4Address) h.hostAddress else null
    }

    private fun ekle(b: Bulunan) {
        val eski = bulunanlar[b.url]
        // NSD'den gelen adı, taramadan gelenin önüne geçir
        if (eski == null || (eski.kaynak == "tarama" && b.kaynak == "nsd")) {
            bulunanlar[b.url] = b
            bildir()
        }
    }

    private fun bildir() {
        dinleyici(liste)
    }

    /**
     * Yedek: alt ağdaki adresleri 8101 portunda /ping ile tarar (en fazla 253 adres, paralel, ~3 sn).
     * [ilerleme] ve [bitti] ana iş parçacığında çağrılır.
     */
    fun agiTara(ilerleme: (yapilan: Int, toplam: Int) -> Unit, bitti: () -> Unit) {
        if (taraniyor) return
        taraniyor = true
        Thread({
            val adresler = LinkedHashSet<String>()
            for (a in Ag.arayuzler()) {
                val t = Ag.tur(a.ad)
                if (t == "wifi" || t == "hotspot" || t == "lan") adresler.addAll(Ag.altAg(a.adres, a.onek))
            }
            val toplam = adresler.size
            val sayac = AtomicInteger(0)
            val havuz = Executors.newFixedThreadPool(48)
            for (ip in adresler) {
                havuz.execute {
                    if (!taraniyor) return@execute
                    val url = "http://$ip:${Masa.PORT}"
                    if (pingDene(url, 450)) {
                        val ad = masaAdi(url) ?: ip
                        ana.post { ekle(Bulunan(ad, ip, Masa.PORT, "tarama")) }
                    }
                    val n = sayac.incrementAndGet()
                    if (n % 16 == 0 || n == toplam) ana.post { ilerleme(n, toplam) }
                }
            }
            havuz.shutdown()
            try { havuz.awaitTermination(20, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
            taraniyor = false
            ana.post { bitti() }
        }, "okey-tarama").apply { isDaemon = true }.start()
    }

    fun taramayiDurdur() {
        taraniyor = false
    }

    /** Masadaki oyuncu adları ("Ahmet, Ayşe") ya da null */
    private fun masaAdi(url: String): String? {
        return try {
            val j = JSONObject(oku("$url/state", 1500) ?: return null)
            val seats = j.optJSONArray("seats") ?: return null
            val adlar = ArrayList<String>()
            for (k in 0 until seats.length()) {
                val s = seats.optJSONObject(k) ?: continue
                s.optString("name").takeIf { it.isNotBlank() }?.let { adlar.add(it) }
            }
            if (adlar.isEmpty()) null else adlar.joinToString(", ")
        } catch (_: Exception) {
            null
        }
    }

    companion object {
        /** url (http://host:port) bir 101 Okey masası mı? */
        fun pingDene(url: String, zamanAsimi: Int): Boolean {
            val b = oku("$url/ping", zamanAsimi) ?: return false
            return b.contains("101-okey")
        }

        fun oku(url: String, zamanAsimi: Int): String? {
            var c: HttpURLConnection? = null
            return try {
                c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = zamanAsimi
                c.readTimeout = zamanAsimi + 500
                c.instanceFollowRedirects = false
                c.setRequestProperty("Accept-Encoding", "identity")
                if (c.responseCode != 200) return null
                c.inputStream.bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                null
            } finally {
                try { c?.disconnect() } catch (_: Exception) {}
            }
        }
    }
}
