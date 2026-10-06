package io.github.ahmetemreozumagi.okey101

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException

/** HTTP isteği ayrıştırma: istek satırı, sorgu, başlıklar, gövde, sınırlar */
class HttpIstekTest {
    private fun oku(s: String) = HttpIstek.oku(ByteArrayInputStream(s.toByteArray(Charsets.UTF_8)))

    @Test
    fun getIstegiSorguVeBasliklarlaOkunur() {
        val i = oku("GET /state?token=abc%20d&x=1 HTTP/1.1\r\nHost: 192.168.1.5:8101\r\nAccept-Encoding: gzip, deflate\r\n\r\n")!!
        assertEquals("GET", i.metod)
        assertEquals("/state", i.yol)
        assertEquals("abc d", i.sorgu["token"])
        assertEquals("1", i.sorgu["x"])
        assertEquals("192.168.1.5:8101", i.baslik("HOST"))
        assertTrue(i.gzipKabul)
        assertEquals(0, i.govde.size)
    }

    @Test
    fun postGovdesiContentLengthKadarOkunur() {
        val govde = "{\"type\":\"join\",\"name\":\"Ayşe\"}"
        val bayt = govde.toByteArray(Charsets.UTF_8)
        val i = oku("POST /api HTTP/1.1\r\ncontent-type: application/json\r\nContent-Length: ${bayt.size}\r\n\r\n$govde")!!
        assertEquals("POST", i.metod)
        assertEquals("/api", i.yol)
        assertEquals(govde, i.govdeMetni())
        assertEquals(false, i.gzipKabul)
    }

    @Test
    fun sadeceLfIleBitenSatirlarDaOlur() {
        val i = oku("GET /ping HTTP/1.1\nHost: x\n\n")!!
        assertEquals("/ping", i.yol)
        assertEquals(emptyMap<String, String>(), i.sorgu)
    }

    @Test
    fun bosAkisNullDoner() {
        assertNull(oku(""))
    }

    @Test
    fun cokBuyukGovdeReddedilir() {
        assertThrows(IOException::class.java) { oku("POST /api HTTP/1.1\r\nContent-Length: 999999\r\n\r\n") }
    }

    @Test
    fun yarimGovdeHataVerir() {
        assertThrows(IOException::class.java) { oku("POST /api HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc") }
    }

    @Test
    fun bozukIstekSatiriHataVerir() {
        assertThrows(IOException::class.java) { oku("SAÇMA\r\n\r\n") }
    }

    @Test
    fun sorguAyirmaUrlCozer() {
        val m = HttpIstek.sorguAyir("a=1&b=%C3%A7ay&c&d=x%3Dy")
        assertEquals("1", m["a"])
        assertEquals("çay", m["b"])
        assertEquals("", m["c"])
        assertEquals("x=y", m["d"])
    }
}
