package io.github.ahmetemreozumagi.okey101

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher

/**
 * Ana ekran: iki büyük tuş.
 *   Masa kur            → oyun bu telefonda çalışır, kuran da buradan oynar
 *   Arkadaşına bağlan   → aynı ağda masa açmış telefonlar listelenir (NSD), yedek olarak ağ taraması ve elle adres
 * Görünümler kodla kurulur; dış kütüphane yok.
 */
class AnaEkran : Activity() {
    private lateinit var kok: FrameLayout
    private lateinit var anaPanel: LinearLayout
    private lateinit var baglanPanel: LinearLayout
    private lateinit var masaKurDugme: Button
    private lateinit var masaKurAciklama: TextView
    private lateinit var masaKapatDugme: Button
    private lateinit var liste: LinearLayout
    private lateinit var durum: TextView
    private lateinit var donuyor: ProgressBar
    private lateinit var adresGiris: EditText
    private lateinit var taraDugme: Button
    private var bulucu: MasaBulucu? = null
    private var geriCb: OnBackInvokedCallback? = null
    private var otomatikTarama: Runnable? = null

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density + .5f).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        KenardanKenara.uygula(this)
        kok = FrameLayout(this)
        kok.background = getDrawable(R.drawable.arkaplan)
        val kaydir = ScrollView(this)
        kaydir.isFillViewport = true
        kok.addView(kaydir, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val icerik = FrameLayout(this)
        kaydir.addView(icerik, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        anaPanel = anaPaneliKur()
        baglanPanel = baglanPaneliKur()
        baglanPanel.visibility = View.GONE
        val lp = { FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL } }
        icerik.addView(anaPanel, lp())
        icerik.addView(baglanPanel, lp())
        setContentView(kok)
        KenardanKenara.boslukBirak(kok, klavyeDahil = true)
    }

    // ---------- Görünümler ----------
    private fun sutun(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(22), dp(28), dp(22), dp(28))
    }

    private fun yazi(metin: CharSequence, boyut: Float, kalin: Boolean = false, soluk: Boolean = false, ortala: Boolean = true): TextView = TextView(this).apply {
        text = metin
        setTextSize(TypedValue.COMPLEX_UNIT_SP, boyut)
        if (kalin) setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(if (soluk) R.color.yazi_soluk else R.color.fildisi))
        if (ortala) gravity = Gravity.CENTER_HORIZONTAL
        setLineSpacing(0f, 1.15f)
    }

    private fun buyukDugme(metin: String, birincil: Boolean, tikla: () -> Unit): Button = Button(this).apply {
        text = metin
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(getColor(R.color.murekkep))
        background = getDrawable(if (birincil) R.drawable.dugme_birincil else R.drawable.dugme_ikincil)
        stateListAnimator = null
        minHeight = dp(68)
        setPadding(dp(20), dp(14), dp(20), dp(14))
        setOnClickListener { tikla() }
    }

    private fun kucukDugme(metin: String, tikla: () -> Unit): Button = Button(this).apply {
        text = metin
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(getColor(R.color.fildisi))
        background = getDrawable(R.drawable.dugme_kucuk)
        stateListAnimator = null
        minHeight = dp(48)
        setPadding(dp(18), dp(10), dp(18), dp(10))
        setOnClickListener { tikla() }
    }

    private fun bosluk(h: Int): View = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }

    private fun anaPaneliKur(): LinearLayout {
        val p = sutun()
        p.addView(yazi(getString(R.string.uygulama_adi), 34f, kalin = true))
        p.addView(bosluk(8))
        p.addView(yazi(getString(R.string.alt_baslik), 16f, soluk = true))
        p.addView(bosluk(30))

        masaKurDugme = buyukDugme(getString(R.string.masa_kur), true) { masaKur() }
        p.addView(masaKurDugme, genis())
        p.addView(bosluk(8))
        masaKurAciklama = yazi(getString(R.string.masa_kur_aciklama), 14f, soluk = true)
        p.addView(masaKurAciklama, genis(yatay = 8))
        masaKapatDugme = kucukDugme(getString(R.string.masayi_kapat)) { masayiKapatSor() }
        masaKapatDugme.visibility = View.GONE
        p.addView(bosluk(8))
        p.addView(masaKapatDugme)
        p.addView(bosluk(26))

        p.addView(buyukDugme(getString(R.string.arkadasina_baglan), false) { baglanPaneliAc() }, genis())
        p.addView(bosluk(8))
        p.addView(yazi(getString(R.string.arkadasina_baglan_aciklama), 14f, soluk = true), genis(yatay = 8))
        p.addView(bosluk(40))

        val surum = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        p.addView(yazi(getString(R.string.gizlilik), 12f, soluk = true))
        p.addView(bosluk(4))
        p.addView(yazi(getString(R.string.kaynak) + " · " + getString(R.string.surum, surum), 12f, soluk = true))
        return p
    }

    private fun genis(yatay: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            val en = minOf(resources.displayMetrics.widthPixels, dp(520))
            width = en - dp(44)
            marginStart = dp(yatay); marginEnd = dp(yatay)
        }

    private fun baglanPaneliKur(): LinearLayout {
        val p = sutun()
        p.addView(yazi(getString(R.string.agdaki_masalar), 26f, kalin = true))
        p.addView(bosluk(14))
        liste = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        p.addView(liste, genis())
        val satir = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        donuyor = ProgressBar(this).apply { layoutParams = LinearLayout.LayoutParams(dp(22), dp(22)).apply { marginEnd = dp(10) } }
        durum = yazi(getString(R.string.araniyor), 14f, soluk = true, ortala = false)
        satir.addView(donuyor)
        satir.addView(durum)
        p.addView(bosluk(10))
        p.addView(satir, genis(yatay = 8))
        p.addView(bosluk(14))
        taraDugme = kucukDugme(getString(R.string.agi_tara)) { agiTara() }
        p.addView(taraDugme)
        p.addView(bosluk(30))

        p.addView(yazi(getString(R.string.adres_elle), 16f, kalin = true))
        p.addView(bosluk(8))
        adresGiris = EditText(this).apply {
            hint = getString(R.string.adres_ipucu)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setSingleLine()
            setTextColor(getColor(R.color.fildisi))
            setHintTextColor(getColor(R.color.yazi_soluk))
            background = getDrawable(R.drawable.kutu)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setOnEditorActionListener { _, _, _ -> elleBaglan(); true }
        }
        p.addView(adresGiris, genis())
        p.addView(bosluk(10))
        p.addView(buyukDugme(getString(R.string.baglan), true) { elleBaglan() }, genis())
        p.addView(bosluk(26))
        p.addView(kucukDugme(getString(R.string.geri)) { panelKapat() })
        return p
    }

    // ---------- Masa kur ----------
    override fun onResume() {
        super.onResume()
        masaDurumunuGoster()
        if (baglanPanel.visibility == View.VISIBLE) bulucu?.basla()
    }

    override fun onPause() {
        bulucu?.dur()
        super.onPause()
    }

    private fun masaDurumunuGoster() {
        val acik = Masa.calisiyor
        masaKurDugme.text = getString(if (acik) R.string.masaya_don else R.string.masa_kur)
        masaKurDugme.isEnabled = true
        masaKurAciklama.text = getString(if (acik) R.string.masa_acik else R.string.masa_kur_aciklama)
        masaKapatDugme.visibility = if (acik) View.VISIBLE else View.GONE
    }

    private fun masaKur() {
        if (Masa.calisiyor) {
            masayaGit()
            return
        }
        masaKurDugme.isEnabled = false
        masaKurDugme.text = getString(R.string.masa_kuruluyor)
        Masa.kur(this) { hata ->
            if (isFinishing || isDestroyed) return@kur
            masaDurumunuGoster()
            if (hata == null) masayaGit()
            else Toast.makeText(this, getString(R.string.masa_kurulamadi, hata), Toast.LENGTH_LONG).show()
        }
    }

    private fun masayaGit() {
        startActivity(
            Intent(this, MasaEkrani::class.java)
                .putExtra(MasaEkrani.URL, "http://127.0.0.1:${Masa.port}/")
                .putExtra(MasaEkrani.HOST, true),
        )
    }

    private fun masayiKapatSor() {
        AlertDialog.Builder(this, R.style.Pencere)
            .setTitle(R.string.masa_kapanacak_baslik)
            .setMessage(R.string.masa_kapanacak)
            .setNegativeButton(R.string.vazgec, null)
            .setPositiveButton(R.string.kapat_ve_cik) { _, _ ->
                Masa.kapat()
                masaDurumunuGoster()
            }
            .show()
    }

    // ---------- Arkadaşına bağlan ----------
    private fun baglanPaneliAc() {
        anaPanel.visibility = View.GONE
        baglanPanel.visibility = View.VISIBLE
        geriyiBagla()
        liste.removeAllViews()
        durum.text = getString(R.string.araniyor)
        donuyor.visibility = View.VISIBLE
        val b = MasaBulucu(this) { listeyiGoster(it) }
        bulucu = b
        b.basla()
        // Birkaç saniyede NSD bir şey bulamazsa kendiliğinden ağı tara
        val r = Runnable { if (liste.childCount == 0) agiTara() }
        otomatikTarama = r
        kok.postDelayed(r, 3500)
    }

    private fun panelKapat() {
        otomatikTarama?.let { kok.removeCallbacks(it) }
        bulucu?.taramayiDurdur()
        bulucu?.dur()
        bulucu = null
        baglanPanel.visibility = View.GONE
        anaPanel.visibility = View.VISIBLE
        geriyiCoz()
    }

    private fun listeyiGoster(masalar: List<MasaBulucu.Bulunan>) {
        liste.removeAllViews()
        for (m in masalar) {
            val satir = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = getDrawable(R.drawable.dugme_kucuk)
                setPadding(dp(16), dp(12), dp(16), dp(12))
                isClickable = true
                setOnClickListener { baglan(m.url) }
            }
            satir.addView(yazi(m.ad, 19f, kalin = true, ortala = false))
            satir.addView(yazi("${m.host}:${m.port}", 13f, soluk = true, ortala = false))
            liste.addView(satir, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) })
        }
        if (masalar.isNotEmpty() && donuyor.visibility == View.VISIBLE && durum.text == getString(R.string.araniyor)) {
            durum.text = ""
        }
    }

    private fun agiTara() {
        val b = bulucu ?: return
        taraDugme.isEnabled = false
        donuyor.visibility = View.VISIBLE
        durum.text = getString(R.string.ag_taraniyor, 0, 0)
        b.agiTara({ yapilan, toplam -> durum.text = getString(R.string.ag_taraniyor, yapilan, toplam) }) {
            taraDugme.isEnabled = true
            donuyor.visibility = View.GONE
            durum.text = if (liste.childCount == 0) getString(R.string.masa_bulunamadi) else getString(R.string.tarama_bitti)
        }
    }

    private fun elleBaglan() {
        val url = Ag.adresNormalle(adresGiris.text.toString(), Masa.PORT)
        if (url == null) {
            Toast.makeText(this, R.string.adres_gecersiz, Toast.LENGTH_SHORT).show()
            return
        }
        baglan(url)
    }

    /** Önce /ping ile masa var mı diye bakar, sonra oyun ekranını açar */
    private fun baglan(url: String) {
        durum.text = getString(R.string.araniyor)
        donuyor.visibility = View.VISIBLE
        Thread {
            val var_ = MasaBulucu.pingDene(url, 2500)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                donuyor.visibility = View.GONE
                durum.text = ""
                if (var_) {
                    startActivity(Intent(this, MasaEkrani::class.java).putExtra(MasaEkrani.URL, "$url/").putExtra(MasaEkrani.HOST, false))
                } else {
                    Toast.makeText(this, getString(R.string.masa_cevap_vermedi, url.removePrefix("http://")), Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    // ---------- Geri tuşu: bağlan panelindeyken ana panele döner ----------
    private fun geriyiBagla() {
        if (Build.VERSION.SDK_INT >= 33 && geriCb == null) {
            val cb = OnBackInvokedCallback { panelKapat() }
            geriCb = cb
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
        }
    }

    private fun geriyiCoz() {
        if (Build.VERSION.SDK_INT >= 33) geriCb?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
        geriCb = null
    }

    @Deprecated("33 altı için")
    override fun onBackPressed() {
        if (baglanPanel.visibility == View.VISIBLE) panelKapat()
        else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        geriyiCoz()
        bulucu?.dur()
        super.onDestroy()
    }
}
