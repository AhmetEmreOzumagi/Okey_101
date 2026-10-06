package io.github.ahmetemreozumagi.okey101

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import org.json.JSONTokener
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Oyun çekirdeğini çalıştıran, ekranda görünmeyen WebView. İçinde assets/host.js (game.js, pisti.js,
 * uno.js, bot.js, lib.js, engine.js ve host-core.js tek dosyada) yüklüdür. Kotlin tarafı
 * Host.call(json) ile konuşur; çekirdek zamanlayıcı kurmaz, her şeyi biz tetikleriz.
 *
 * WebView ancak ana iş parçacığından kullanılabilir: [cagir] isteği ana iş parçacığına postalar ve
 * cevabı bekler (bu yüzden ana iş parçacığından çağrılamaz), [cagirAsync] cevabı geri çağrıyla verir.
 */
class OyunMotoru(private val ctx: Context) {
    private val ana = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val hazir = CountDownLatch(1)
    @Volatile
    private var kapali = false
    @Volatile
    var yuklemeHatasi: String? = null
        private set

    /** Ana iş parçacığında çağrılır */
    @SuppressLint("SetJavaScriptEnabled")
    fun baslat() {
        val wv = WebView(ctx)
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = false
        wv.settings.blockNetworkLoads = true // çekirdeğin ağa çıkması gerekmez
        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                val yazi = "[çekirdek] ${m.message()}"
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.e(Masa.TAG, yazi) else Log.i(Masa.TAG, yazi)
                return true
            }
        }
        wv.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                hazir.countDown()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    yuklemeHatasi = error.description?.toString() ?: "yükleme hatası"
                    hazir.countDown()
                }
            }
        }
        wv.loadUrl("file:///android_asset/host.html")
        webView = wv
    }

    /** Arka plan iş parçacığından: çekirdeğe istek gönderir, cevabı bekler. */
    fun cagir(istek: JSONObject): MotorCevap {
        check(Looper.myLooper() != Looper.getMainLooper()) { "cagir ana iş parçacığında çağrılamaz" }
        if (!hazir.await(20, TimeUnit.SECONDS)) return MotorCevap.hata(503, "Oyun çekirdeği hazır değil")
        val kuyruk = ArrayBlockingQueue<String>(1)
        ana.post { calistir(istek) { kuyruk.offer(it) } }
        val s = kuyruk.poll(15, TimeUnit.SECONDS) ?: return MotorCevap.hata(503, "Oyun çekirdeği cevap vermedi")
        return MotorCevap.coz(s)
    }

    /** Ana iş parçacığından: cevap geri çağrıyla (yine ana iş parçacığında) gelir. */
    fun cagirAsync(istek: JSONObject, deneme: Int = 0, cb: (MotorCevap) -> Unit) {
        if (hazir.count > 0) {
            if (deneme > 200) { cb(MotorCevap.hata(503, "Oyun çekirdeği hazır değil")); return }
            ana.postDelayed({ cagirAsync(istek, deneme + 1, cb) }, 100)
            return
        }
        calistir(istek) { cb(MotorCevap.coz(it)) }
    }

    private fun calistir(istek: JSONObject, cb: (String) -> Unit) {
        val wv = webView
        if (wv == null || kapali) {
            cb("null")
            return
        }
        try {
            wv.evaluateJavascript("Host.call(" + JSONObject.quote(istek.toString()) + ")") { cb(it ?: "null") }
        } catch (e: Exception) {
            Log.e(Masa.TAG, "evaluateJavascript", e)
            cb("null")
        }
    }

    fun kapat() {
        kapali = true
        ana.post {
            try { webView?.destroy() } catch (_: Exception) {}
            webView = null
        }
    }
}

/** Çekirdeğin cevabı: HTTP kodu ve gövdesi, canlı bağlantılara gidecekler, kayıt gereksinimi, masa adı. */
class MotorCevap(val kod: Int, val govde: String?, val push: Map<Int, String>, val kaydet: Boolean, val masaAdi: String?) {
    fun httpCevap(): HttpCevap = HttpCevap.json(kod, govde ?: "{}")

    companion object {
        fun hata(kod: Int, mesaj: String) = MotorCevap(kod, "{\"ok\":false,\"error\":${JSONObject.quote(mesaj)}}", emptyMap(), false, null)

        /** evaluateJavascript'in verdiği ham sonuç: JSON metin olarak kodlanmış bir dize (ya da hata/yüklenmemişse "null") */
        fun coz(ham: String): MotorCevap {
            return try {
                val deger = JSONTokener(ham).nextValue()
                val metin = deger as? String ?: return hata(500, "Oyun çekirdeği hata verdi")
                val o = JSONObject(metin)
                val push = HashMap<Int, String>()
                o.optJSONObject("push")?.let { p ->
                    for (k in p.keys()) k.toIntOrNull()?.let { push[it] = p.getString(k) }
                }
                MotorCevap(
                    o.optInt("code", 200),
                    if (o.has("body") && !o.isNull("body")) o.getString("body") else null,
                    push,
                    o.optBoolean("save", false),
                    o.optString("hostName", "").takeIf { it.isNotEmpty() },
                )
            } catch (e: Exception) {
                Log.e(Masa.TAG, "çekirdek cevabı okunamadı: ${ham.take(200)}", e)
                hata(500, "Oyun çekirdeğinin cevabı okunamadı")
            }
        }
    }
}
