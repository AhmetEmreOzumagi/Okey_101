package io.github.ahmetemreozumagi.okey101

import java.net.Inet4Address
import java.net.NetworkInterface

/** Ağ yardımcıları: telefonun adresleri, Wi-Fi / hotspot ayrımı, alt ağ taraması için adres listesi. */
object Ag {
    class Arayuz(val ad: String, val adres: String, val onek: Int)

    /** Web arayüzünün beklediği ağ bilgisi (server.js'teki netInfo ile aynı alanlar) */
    class NetBilgi(val sharing: Boolean, val wifi: String = "", val ssid: String = "", val public: String = "") {
        fun json(): String = "{\"sharing\":$sharing,\"ssid\":\"$ssid\",\"wifi\":\"$wifi\",\"public\":\"$public\"}"
    }

    // Telefonların ulaşamayacağı arayüzler: mobil veri, VPN, Wi-Fi Direct, çevirmeli...
    private val ATLA = Regex("^(lo|rmnet|r_rmnet|ccmni|ccemni|tun|ppp|dummy|p2p|v4-|clat|wwan|umts|pdp|ifb|sit|ip6|gre|erspan|ipsec|utun|vmnet|docker|veth|bridge)", RegexOption.IGNORE_CASE)
    private val HOTSPOT = Regex("^(wlan[1-9]|swlan|ap\\d|softap|wifi_ap|wl_ap|ap_br|wlan_ap|rndis|usb\\d|bt-pan|ncm)", RegexOption.IGNORE_CASE)

    /** wifi | hotspot | lan | other */
    fun tur(ad: String): String = when {
        HOTSPOT.containsMatchIn(ad) -> "hotspot"
        ad.startsWith("wlan", true) || ad.startsWith("wifi", true) || ad.startsWith("wl", true) -> "wifi"
        ad.startsWith("eth", true) || ad.startsWith("en", true) -> "lan"
        else -> "other"
    }

    fun atlanir(ad: String): Boolean = ATLA.containsMatchIn(ad)

    /** Telefonun kullanılabilir IPv4 adresleri (yerel ağdaki telefonların ulaşabileceği arayüzler) */
    fun arayuzler(): List<Arayuz> {
        val out = ArrayList<Arayuz>()
        try {
            val ifs = NetworkInterface.getNetworkInterfaces() ?: return out
            for (nif in ifs) {
                if (!nif.isUp || nif.isLoopback || atlanir(nif.name)) continue
                for (ia in nif.interfaceAddresses) {
                    val a = ia.address as? Inet4Address ?: continue
                    val s = a.hostAddress ?: continue
                    if (s.startsWith("169.254.") || s.startsWith("127.")) continue
                    out.add(Arayuz(nif.name, s, ia.networkPrefixLength.toInt()))
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    /**
     * Arkadaşların gireceği adresler, en olası önde (Wi-Fi → hotspot → diğer), ve ağ bilgisi.
     * Telefon hem Wi-Fi'da hem hotspot açmışsa Wi-Fi adresi önce gelir (server.js ile aynı mantık).
     */
    fun adresler(arayuzler: List<Arayuz>, port: Int): Pair<List<String>, NetBilgi> {
        val wifiVar = arayuzler.any { tur(it.ad) == "wifi" }
        val hotspotVar = arayuzler.any { tur(it.ad) == "hotspot" }
        val puan = { a: Arayuz ->
            val t = tur(a.ad)
            (if (t == "wifi") -20 else if (t == "lan") -18 else 0) + (if (t == "hotspot") -10 else 0) +
                (if (a.adres.startsWith("192.168.") || a.adres.startsWith("172.") || a.adres.startsWith("10.")) 0 else 1)
        }
        val urls = arayuzler.sortedBy(puan).map { "http://${it.adres}:$port" }
        return Pair(urls, NetBilgi(sharing = hotspotVar && !wifiVar))
    }

    /** Alt ağdaki diğer adresler (en fazla /24, yani 253 adres); kendi adresi hariç */
    fun altAg(adres: String, onek: Int): List<String> {
        val p = adres.split('.').map { it.toIntOrNull() ?: return emptyList() }
        if (p.size != 4) return emptyList()
        val kendi = (p[0] shl 24) or (p[1] shl 16) or (p[2] shl 8) or p[3]
        val bit = onek.coerceIn(24, 30)
        val maske = (-1 shl (32 - bit))
        val ag = kendi and maske
        val out = ArrayList<String>()
        val adet = (1 shl (32 - bit)) - 2
        for (i in 1..adet) {
            val x = ag + i
            if (x == kendi) continue
            out.add("${(x ushr 24) and 255}.${(x ushr 16) and 255}.${(x ushr 8) and 255}.${x and 255}")
        }
        return out
    }

    /** Elle yazılan adresi düzenler: "192.168.1.5", "192.168.1.5:8101", "http://192.168.1.5:8101/" → "http://192.168.1.5:8101" */
    fun adresNormalle(giris: String, varsayilanPort: Int): String? {
        var s = giris.trim().replace(" ", "")
        if (s.isEmpty()) return null
        s = s.replace(Regex("^https?://", RegexOption.IGNORE_CASE), "")
        s = s.substringBefore('/').substringBefore('?')
        val host: String
        val port: Int
        val i = s.lastIndexOf(':')
        if (i > 0 && s.indexOf(':') == i) {
            host = s.substring(0, i)
            port = s.substring(i + 1).toIntOrNull() ?: return null
        } else {
            host = s
            port = varsayilanPort
        }
        if (port !in 1..65535) return null
        if (!Regex("^[A-Za-z0-9.-]+$").matches(host) || host.endsWith(".") || host.startsWith(".")) return null
        return "http://$host:$port"
    }
}
