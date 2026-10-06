package io.github.ahmetemreozumagi.okey101

import java.security.MessageDigest

/**
 * Telefonlara gönderilen oyun sayfası. server.js'teki buildPage gibi public/index.html tek dosya haline getirilir:
 * style.css bir <style> içine, betikler (engine.js, qr.js, cards.js, app.js) <script> içine gömülür.
 * Zayıf Wi-Fi'da beş ayrı dosya yerine tek istek gider; yarım yüklenen sayfa olmaz.
 */
class Sayfa(val ham: ByteArray, val gz: ByteArray, val etag: String) {
    companion object {
        private val BETIK = Regex("<script src=\"([a-z0-9-]+\\.js)\"></script>")
        private val KAPANIS = Regex("</script", RegexOption.IGNORE_CASE)

        /** [oku]: public/ içindeki dosya adını içeriğine çevirir */
        fun kur(oku: (String) -> String): Sayfa {
            val ham = gom(oku("index.html"), oku).toByteArray(Charsets.UTF_8)
            val sha = MessageDigest.getInstance("SHA-1").digest(ham)
            val etag = "\"" + sha.joinToString("") { "%02x".format(it) }.substring(0, 16) + "\""
            return Sayfa(ham, HttpCevap.gzip(ham), etag)
        }

        fun gom(html: String, oku: (String) -> String): String {
            var h = html.replace("<link rel=\"stylesheet\" href=\"style.css\">", "<style>" + oku("style.css") + "</style>")
            h = BETIK.replace(h) { m -> "<script>" + guvenli(oku(m.groupValues[1])) + "</script>" }
            return h
        }

        /** Betiğin içindeki "</script" sayfayı bölmesin */
        fun guvenli(js: String): String = KAPANIS.replace(js) { "<\\/script" }

        fun icerikTuru(ad: String): String = when (ad.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html; charset=utf-8"
            "js" -> "application/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "json" -> "application/json"
            else -> "application/octet-stream"
        }
    }
}
