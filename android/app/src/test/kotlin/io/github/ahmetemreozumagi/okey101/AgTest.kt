package io.github.ahmetemreozumagi.okey101

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ağ yardımcıları: arayüz türleri, adres sıralaması, alt ağ, elle yazılan adres */
class AgTest {
    @Test
    fun arayuzTurleri() {
        assertEquals("wifi", Ag.tur("wlan0"))
        assertEquals("hotspot", Ag.tur("wlan1"))
        assertEquals("hotspot", Ag.tur("swlan0"))
        assertEquals("hotspot", Ag.tur("ap0"))
        assertEquals("hotspot", Ag.tur("softap0"))
        assertEquals("hotspot", Ag.tur("rndis0"))
        assertEquals("lan", Ag.tur("eth0"))
        assertEquals("other", Ag.tur("rmnet_data0"))
        assertTrue(Ag.atlanir("rmnet_data0"))
        assertTrue(Ag.atlanir("tun0"))
        assertTrue(Ag.atlanir("p2p0"))
        assertFalse(Ag.atlanir("wlan0"))
        assertFalse(Ag.atlanir("swlan0"))
    }

    @Test
    fun wifiAdresiOndeHotspotYedek() {
        val (urls, net) = Ag.adresler(listOf(Ag.Arayuz("swlan0", "192.168.43.1", 24), Ag.Arayuz("wlan0", "192.168.1.20", 24)), 8101)
        assertEquals(listOf("http://192.168.1.20:8101", "http://192.168.43.1:8101"), urls)
        assertFalse("Wi-Fi varken paylaşım bilgisi gösterilmez", net.sharing)
    }

    @Test
    fun sadeceHotspotVarsaPaylasim() {
        val (urls, net) = Ag.adresler(listOf(Ag.Arayuz("ap0", "192.168.43.1", 24)), 8101)
        assertEquals(listOf("http://192.168.43.1:8101"), urls)
        assertTrue(net.sharing)
        assertEquals("{\"sharing\":true,\"ssid\":\"\",\"wifi\":\"\",\"public\":\"\"}", net.json())
    }

    @Test
    fun agYoksaBosListe() {
        val (urls, net) = Ag.adresler(emptyList(), 8101)
        assertTrue(urls.isEmpty())
        assertFalse(net.sharing)
    }

    @Test
    fun altAgKendiAdresiHaricTumAdresler() {
        val l = Ag.altAg("192.168.1.34", 24)
        assertEquals(253, l.size)
        assertEquals("192.168.1.1", l.first())
        assertEquals("192.168.1.254", l.last())
        assertFalse(l.contains("192.168.1.34"))
        assertFalse(l.contains("192.168.1.0"))
        assertFalse(l.contains("192.168.1.255"))
    }

    @Test
    fun genisAgEnFazla24Taranir() {
        val l = Ag.altAg("10.20.30.40", 16)
        assertEquals(253, l.size)
        assertTrue(l.all { it.startsWith("10.20.30.") })
        assertEquals(1, Ag.altAg("172.20.10.2", 30).size)
        assertTrue(Ag.altAg("bozuk", 24).isEmpty())
    }

    @Test
    fun elleYazilanAdresDuzenlenir() {
        assertEquals("http://192.168.1.34:8101", Ag.adresNormalle("192.168.1.34", 8101))
        assertEquals("http://192.168.1.34:9000", Ag.adresNormalle(" 192.168.1.34:9000 ", 8101))
        assertEquals("http://192.168.1.34:8101", Ag.adresNormalle("http://192.168.1.34:8101/", 8101))
        assertEquals("http://192.168.1.34:8101", Ag.adresNormalle("HTTPS://192.168.1.34/index.html?x=1", 8101))
        assertEquals("http://ahmet-telefon.local:8101", Ag.adresNormalle("ahmet-telefon.local", 8101))
        assertNull(Ag.adresNormalle("", 8101))
        assertNull(Ag.adresNormalle("192.168.1.34:abc", 8101))
        assertNull(Ag.adresNormalle("192.168.1.34:70000", 8101))
        assertNull(Ag.adresNormalle("ne olduğu belirsiz", 8101))
    }
}
