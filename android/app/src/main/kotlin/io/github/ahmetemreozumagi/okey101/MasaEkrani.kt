package io.github.ahmetemreozumagi.okey101

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * Oyun ekranı: public/ arayüzünü gösteren tam ekran WebView. Masa kuran telefonda 127.0.0.1'e,
 * misafirde arkadaşın adresine bağlanır. Sistem çubukları gizli, içerik çentiğin altına girmez
 * (çentik ve çubuk boşlukları çuha renginde kalır), ekran dönünce yeniden yaratılmaz.
 */
class MasaEkrani : Activity() {
    private lateinit var kok: FrameLayout
    private lateinit var web: WebView
    private var ozelGorunum: View? = null
    private var ozelCb: WebChromeClient.CustomViewCallback? = null
    private var url = ""
    private var host = false
    private var geriCb: OnBackInvokedCallback? = null
    private var hataPenceresi: AlertDialog? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        url = intent.getStringExtra(URL) ?: ""
        host = intent.getBooleanExtra(HOST, false)
        if (url.isEmpty() || (host && !Masa.calisiyor)) {
            finish()
            return
        }
        // Oyun sürerken ekran kapanmasın (masa kuran telefonda oyun durur, misafirde bağlantı kopar)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        KenardanKenara.uygula(this)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        kok = FrameLayout(this)
        kok.setBackgroundColor(getColor(R.color.cuha_koyu))
        web = WebView(this)
        web.setBackgroundColor(getColor(R.color.cuha_koyu))
        kok.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(kok)
        KenardanKenara.boslukBirak(kok, klavyeDahil = true)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // localStorage: oyuncu adı, oturum anahtarı, ıstaka dizilişi
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        }
        web.isHapticFeedbackEnabled = true
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) Log.w(Masa.TAG, "[sayfa] ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                return true
            }

            // Menüdeki "Tam ekran": sayfa requestFullscreen çağırınca WebView yeni bir görünüm verir
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                ozelGorunum?.let { callback.onCustomViewHidden(); return }
                ozelGorunum = view
                ozelCb = callback
                kok.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                web.visibility = View.GONE
            }

            override fun onHideCustomView() {
                ozelGorunumuKapat()
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Oyun tek sayfadır; sadece masanın kendi adresi yüklenir
                val hedef = request.url
                val benim = Uri.parse(url)
                return !(hedef.host == benim.host && hedef.port == benim.port)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                Log.w(Masa.TAG, "sayfa yüklenemedi: ${error.description}")
                if (host) view.postDelayed({ if (!isFinishing) view.loadUrl(url) }, 1000)
                else baglantiHatasi()
            }
        }
        geriyiBagla()
        sistemCubuklariniGizle()
        web.loadUrl(url)
    }

    private fun ozelGorunumuKapat() {
        val v = ozelGorunum ?: return
        kok.removeView(v)
        ozelGorunum = null
        web.visibility = View.VISIBLE
        ozelCb?.onCustomViewHidden()
        ozelCb = null
        sistemCubuklariniGizle()
    }

    /** Sistem çubukları gizli; kenardan kaydırınca geçici olarak görünür */
    @Suppress("DEPRECATION")
    private fun sistemCubuklariniGizle() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) sistemCubuklariniGizle()
    }

    // ---------- Geri tuşu ----------
    // Hedef 36'da onBackPressed çağrılmaz; OnBackInvokedCallback kullanılır (33 altı için onBackPressed kalır)
    private fun geriyiBagla() {
        if (Build.VERSION.SDK_INT >= 33) {
            val cb = OnBackInvokedCallback { geri() }
            geriCb = cb
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        }
    }

    @Deprecated("33 altı için")
    override fun onBackPressed() {
        geri()
    }

    private fun geri() {
        if (ozelGorunum != null) {
            ozelGorunumuKapat()
            return
        }
        if (!host) {
            finish()
            return
        }
        // Masa kuran telefon: çıkınca masa kapanır, önce uyar
        AlertDialog.Builder(this, R.style.Pencere)
            .setTitle(R.string.masa_kapanacak_baslik)
            .setMessage(R.string.masa_kapanacak)
            .setNegativeButton(R.string.vazgec, null)
            .setPositiveButton(R.string.kapat_ve_cik) { _, _ ->
                Masa.kapat()
                finish()
            }
            .show()
    }

    private fun baglantiHatasi() {
        if (isFinishing || hataPenceresi?.isShowing == true) return
        hataPenceresi = AlertDialog.Builder(this, R.style.Pencere)
            .setTitle(R.string.baglanti_koptu_baslik)
            .setMessage(getString(R.string.baglanti_koptu, url.removePrefix("http://")))
            .setCancelable(false)
            .setPositiveButton(R.string.tekrar_dene) { _, _ -> web.loadUrl(url) }
            .setNegativeButton(R.string.ana_ekran) { _, _ -> finish() }
            .show()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33) geriCb?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        hataPenceresi?.dismiss()
        if (::web.isInitialized) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val URL = "url"
        const val HOST = "host"
    }
}

/** Kenardan kenara ekran yardımcıları (destek kütüphanesi kullanılmadan) */
object KenardanKenara {
    @Suppress("DEPRECATION")
    fun uygula(a: Activity) {
        val w = a.window
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false)
        } else {
            w.decorView.systemUiVisibility = w.decorView.systemUiVisibility or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        if (Build.VERSION.SDK_INT < 35) {
            w.statusBarColor = Color.TRANSPARENT
            w.navigationBarColor = Color.TRANSPARENT
        }
    }

    /** Sistem çubukları, çentik (ve istenirse klavye) kadar iç boşluk bırakır; çubuklar gizliyse boşluk sıfırdır */
    @Suppress("DEPRECATION")
    fun boslukBirak(v: View, klavyeDahil: Boolean) {
        v.setOnApplyWindowInsetsListener { gorunum, ins ->
            if (Build.VERSION.SDK_INT >= 30) {
                var tip = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
                if (klavyeDahil) tip = tip or WindowInsets.Type.ime()
                val i = ins.getInsets(tip)
                gorunum.setPadding(i.left, i.top, i.right, i.bottom)
            } else {
                var alt = ins.systemWindowInsetBottom
                if (Build.VERSION.SDK_INT >= 28) {
                    val c = ins.displayCutout
                    if (c != null) alt = maxOf(alt, c.safeInsetBottom)
                }
                gorunum.setPadding(ins.systemWindowInsetLeft, ins.systemWindowInsetTop, ins.systemWindowInsetRight, alt)
            }
            ins
        }
        v.requestApplyInsets()
    }
}
