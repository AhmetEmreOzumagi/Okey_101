package io.github.ahmetemreozumagi.okey101

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Masa kuran telefondaki oyun: HTTP sunucusu + gizli WebView'deki oyun çekirdeği + NSD duyurusu.
 * Uygulama açık kaldıkça çalışır (arka plan servisi yok; masa açıkken ekran kapanmaz).
 *
 * Döngüler (hepsi ana iş parçacığında, server.js'teki gibi):
 *   400 ms   süre sayacı ve botlar (tick)
 *   10 sn    SSE ping
 *   2 sn     telefonun adresleri değişti mi (Wi-Fi'dan hotspot'a geçiş vb.)
 *   150 ms   son değişiklikten sonra kayıt (oyun-kaydi.json)
 */
object Masa : HttpSunucu.Isleyici {
    const val TAG = "Okey101"
    const val PORT = 8101
    const val SERVIS_TIPI = "_okey101._tcp."

    @Volatile
    var calisiyor = false
        private set
    @Volatile
    var port = 0
        private set
    @Volatile
    var masaAdi = ""
        private set

    private lateinit var app: Context
    private var motor: OyunMotoru? = null
    private var sunucu: HttpSunucu? = null
    private var sayfa: Sayfa? = null
    private val ana = Handler(Looper.getMainLooper())
    private val arka = Executors.newSingleThreadExecutor { r -> Thread(r, "okey-arka").apply { isDaemon = true } }
    private var kayitDosyasi: File? = null
    private var nsd: NsdManager? = null
    private var nsdDinleyici: NsdManager.RegistrationListener? = null
    @Volatile
    private var sonLan = ""
    @Volatile
    private var tickBekliyor = 0L

    /** Masayı kurar; sonuç ana iş parçacığında [bitti] ile gelir (hata null ise başarılı). */
    fun kur(ctx: Context, bitti: (hata: String?) -> Unit) {
        if (calisiyor) {
            bitti(null)
            return
        }
        app = ctx.applicationContext
        kayitDosyasi = File(app.filesDir, "oyun-kaydi.json")
        val m = OyunMotoru(app)
        motor = m
        m.baslat()
        arka.execute {
            try {
                sayfa = Sayfa.kur { ad -> app.assets.open("public/$ad").bufferedReader().use { it.readText() } }
                val saved = kayitDosyasi?.takeIf { it.isFile }?.readText()
                val init = JSONObject().put("op", "init").put("boot", rastgeleHex(4))
                if (saved != null) init.put("saved", saved)
                val c = m.cagir(init)
                if (c.kod != 200) throw IOException(m.yuklemeHatasi ?: "oyun çekirdeği başlamadı")
                val s = HttpSunucu(this)
                port = s.baslat(PORT..PORT + 9)
                sunucu = s
                calisiyor = true
                Log.i(TAG, "Masa kuruldu: port $port")
                ana.post {
                    nsdKaydet(app.getString(R.string.masa_varsayilan_ad))
                    donguleriBaslat()
                    bitti(null)
                }
            } catch (e: Exception) {
                Log.e(TAG, "masa kurulamadı", e)
                ana.post {
                    temizle()
                    bitti(e.message ?: e.toString())
                }
            }
        }
    }

    /** Masayı kapatır: son durum kaydedilir, sunucu durur, duyuru kalkar. */
    fun kapat() {
        if (!calisiyor && motor == null) return
        calisiyor = false
        ana.removeCallbacksAndMessages(null)
        nsdKaldir()
        sunucu?.durdur()
        sunucu = null
        val m = motor
        motor = null
        arka.execute {
            if (m != null) {
                try {
                    val c = m.cagir(JSONObject().put("op", "dump"))
                    c.govde?.let { yaz(it) }
                } catch (e: Exception) {
                    Log.w(TAG, "son kayıt yazılamadı: ${e.message}")
                }
                m.kapat()
            }
        }
        Log.i(TAG, "Masa kapatıldı")
    }

    private fun temizle() {
        calisiyor = false
        ana.removeCallbacksAndMessages(null)
        nsdKaldir()
        sunucu?.durdur()
        sunucu = null
        motor?.kapat()
        motor = null
    }

    // ---------- Döngüler ----------
    private fun donguleriBaslat() {
        ana.postDelayed(tick, 400)
        ana.postDelayed(ping, 10000)
        ana.post(lanGuncelle)
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!calisiyor) return
            ana.postDelayed(this, 400)
            val m = motor ?: return
            val simdi = System.currentTimeMillis()
            if (tickBekliyor != 0L && simdi - tickBekliyor < 5000) return // önceki tick hâlâ cevaplanmadı
            tickBekliyor = simdi
            m.cagirAsync(JSONObject().put("op", "tick").put("now", simdi)) { c ->
                tickBekliyor = 0L
                uygula(c)
            }
        }
    }

    private val ping = object : Runnable {
        override fun run() {
            if (!calisiyor) return
            sunucu?.ssePing()
            ana.postDelayed(this, 10000)
        }
    }

    private val lanGuncelle = object : Runnable {
        override fun run() {
            if (!calisiyor) return
            ana.postDelayed(this, 2000)
            arka.execute {
                if (!calisiyor) return@execute
                val (urls, net) = Ag.adresler(Ag.arayuzler(), port)
                val json = JSONObject().put("op", "lan").put("urls", JSONArray(urls)).put("net", JSONObject(net.json()))
                val anahtar = json.toString()
                if (anahtar == sonLan) return@execute
                sonLan = anahtar
                Log.i(TAG, "Adresler: ${urls.joinToString(" ")}")
                motor?.let { uygula(it.cagir(json)) }
            }
        }
    }

    private val kaydet = Runnable {
        motor?.cagirAsync(JSONObject().put("op", "dump")) { c ->
            val metin = c.govde ?: return@cagirAsync
            arka.execute { yaz(metin) }
        }
    }

    private fun kaydetPlanla() {
        ana.removeCallbacks(kaydet)
        ana.postDelayed(kaydet, 150)
    }

    private fun yaz(metin: String) {
        val f = kayitDosyasi ?: return
        try {
            val tmp = File(f.path + ".tmp")
            tmp.writeText(metin)
            if (!tmp.renameTo(f)) {
                f.writeText(metin)
                tmp.delete()
            }
        } catch (e: IOException) {
            Log.e(TAG, "Kayıt yazılamadı: ${e.message}")
        }
    }

    /** Çekirdek cevabındaki yan işler: canlı bağlantılara görünüm, kayıt, masa adı */
    private fun uygula(c: MotorCevap) {
        val s = sunucu
        if (s != null) for ((id, v) in c.push) s.sseGonder(id, v)
        if (c.kaydet) ana.post { kaydetPlanla() }
        c.masaAdi?.let { ad -> ana.post { nsdKaydet(ad) } }
    }

    // ---------- NSD (mDNS) duyurusu: "Arkadaşına bağlan" listesinde görünmek için ----------
    private fun nsdKaydet(ad: String) {
        if (!calisiyor) return
        val yeni = ad.ifBlank { app.getString(R.string.masa_varsayilan_ad) }
        if (yeni == masaAdi && nsdDinleyici != null) return
        masaAdi = yeni
        val nm = nsd ?: (app.getSystemService(Context.NSD_SERVICE) as NsdManager).also { nsd = it }
        nsdKaldir()
        val bilgi = NsdServiceInfo().apply {
            serviceName = yeni
            serviceType = SERVIS_TIPI
            port = this@Masa.port
            setAttribute("app", "101-okey")
        }
        val d = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "Ağda duyuruldu: ${info.serviceName}")
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, hata: Int) {
                Log.w(TAG, "NSD kaydı olmadı: $hata")
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, hata: Int) {}
        }
        nsdDinleyici = d
        // Eski kayıt kalkarken aynı adla yeni kayıt çakışmasın diye kısa bir bekleme
        ana.postDelayed({
            if (nsdDinleyici !== d || !calisiyor) return@postDelayed
            try {
                nm.registerService(bilgi, NsdManager.PROTOCOL_DNS_SD, d)
            } catch (e: Exception) {
                Log.w(TAG, "NSD kaydı olmadı", e)
            }
        }, 300)
    }

    private fun nsdKaldir() {
        val d = nsdDinleyici ?: return
        nsdDinleyici = null
        try { nsd?.unregisterService(d) } catch (_: Exception) {}
    }

    // ---------- HTTP isteklerinin karşılığı (arka plan iş parçacıklarında çağrılır) ----------
    override fun sayfa(): Sayfa = sayfa ?: throw IOException("sayfa hazır değil")

    override fun statik(ad: String): HttpCevap? = try {
        val veri = app.assets.open("public/$ad").use { it.readBytes() }
        HttpCevap(200, veri, Sayfa.icerikTuru(ad), mapOf("Cache-Control" to "max-age=3600"))
    } catch (_: IOException) {
        null
    }

    override fun state(token: String, ip: String): HttpCevap {
        val m = motor ?: return HttpCevap.json(503, KAPALI)
        val c = m.cagir(JSONObject().put("op", "state").put("token", token).put("ip", ip))
        uygula(c)
        return c.httpCevap()
    }

    override fun api(govde: String, ip: String): HttpCevap {
        val m = motor ?: return HttpCevap.json(503, KAPALI)
        val body = try {
            JSONObject(govde.ifBlank { "{}" })
        } catch (_: JSONException) {
            return HttpCevap.json(400, "{\"ok\":false,\"error\":\"Geçersiz istek.\"}")
        }
        val c = m.cagir(JSONObject().put("op", "api").put("body", body).put("ip", ip))
        uygula(c)
        return c.httpCevap()
    }

    override fun ping(): HttpCevap = HttpCevap.json(200, "{\"ok\":true,\"app\":\"101-okey\"}")

    override fun sseAcildi(id: Int, token: String, ip: String) {
        val m = motor ?: return
        uygula(m.cagir(JSONObject().put("op", "sseOpen").put("id", id).put("token", token).put("ip", ip)))
    }

    override fun sseKapandi(id: Int) {
        val m = motor ?: return
        uygula(m.cagir(JSONObject().put("op", "sseClose").put("id", id)))
    }

    private const val KAPALI = "{\"ok\":false,\"error\":\"Masa kapalı.\"}"

    private fun rastgeleHex(bayt: Int): String {
        val b = ByteArray(bayt)
        SecureRandom().nextBytes(b)
        return b.joinToString("") { "%02x".format(it) }
    }
}
