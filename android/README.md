# 101 Okey · Pişti — Android uygulaması

Aynı oyunun Android sürümü. Oyun mantığı yeniden yazılmadı: depo kökündeki `game.js`, `pisti.js`, `uno.js`, `bot.js`, `lib.js`, `public/engine.js` ve telefon arayüzü `public/` derleme sırasında uygulamaya paketlenir. Web sürümü (`node baslat.js`) olduğu gibi çalışmaya devam eder; ikisi aynı dosyalardan beslenir.

## Nasıl çalışır?

| Düğme | Ne olur |
| --- | --- |
| **Masa kur** | Telefonda küçük bir HTTP sunucusu açılır (8101). Oyun kuralları ekranda görünmeyen bir WebView'de (`assets/host.js`) çalışır. Kuran kişi de aynı telefondan oynar (`http://127.0.0.1:8101`). Masa, aynı ağdaki telefonlara NSD/mDNS ile `_okey101._tcp` olarak duyurulur; adı masayı kuranın adıdır. Ekrandaki lobide arkadaşlar için adres ve QR görünür; iPhone'lular tarayıcıdan girer. |
| **Arkadaşına bağlan** | Aynı ağdaki masalar listelenir (NSD). Birkaç saniyede bulunamazsa alt ağ 8101 portunda `/ping` ile taranır; adres elle de yazılabilir. Dokununca oyun sayfası tam ekran WebView'de açılır. |

Masa açıkken ekran kapanmaz (arka plan servisi kullanılmaz). Masayı kuran geri tuşuna basarsa "masa kapanacak" diye uyarılır. Oyun kaydı (`oyun-kaydi.json`) uygulamanın kendi klasöründe tutulur; tekrar "Masa kur" deyince kaldığı yerden devam eder.

### Dosyalar

| Dosya | Ne işe yarar |
| --- | --- |
| `host/host-core.js` | server.js'in ağ dışındaki işleri: durum, görünüm, bağlı/kopuk takibi, 400 ms süre/bot döngüsü, lobide uzun süre bağlı olmayanın kalkması, kayıt. Kotlin `Host.call(json)` ile çağırır. |
| `host/paket-onsoz.js`, `host/paket-sonsoz.js` | Paketin başı/sonu: küçük `require()` düzeni ve Node `crypto` yerine `crypto.getRandomValues` yedeği |
| `paketle.js` | Gradle'daki paketleme görevinin Node karşılığı (`npm test` içindeki `tests/android.test.js` bunu kullanır) |
| `app/build.gradle.kts` | `paketleJs` görevi: JS dosyalarını ve `public/`'i assets'e kopyalar; sürüm imzası `~/Okey101-imza/imza.properties`'ten okunur |
| `app/src/main/kotlin/.../HttpSunucu.kt` | HTTP sunucusu: `GET /`, `/state`, `/events` (SSE), `POST /api`, `/ping`, statik dosyalar |
| `.../Sayfa.kt` | `public/index.html`'i css/js gömülü tek sayfa yapar (gzip, ETag) |
| `.../OyunMotoru.kt` | Gizli WebView; `evaluateJavascript` ile çekirdeğe çağrı |
| `.../Masa.kt` | Masa kurma/kapatma, döngüler, kayıt, NSD duyurusu |
| `.../MasaBulucu.kt` | NSD araması, yedek ağ taraması |
| `.../Ag.kt` | Telefonun adresleri, Wi-Fi/hotspot ayrımı, alt ağ, adres düzeltme |
| `.../AnaEkran.kt`, `.../MasaEkrani.kt` | Ana ekran ve tam ekran WebView oyun ekranı |
| `tools/SimgeUret.java` | Simgeleri ve mağaza görsellerini üretir (`java -Djava.awt.headless=true android/tools/SimgeUret.java`) |

Kotlin, dış kütüphane yok (AndroidX bile yok); minSdk 24, targetSdk ve compileSdk 36; AGP 9.4, Gradle 9.6, yerleşik Kotlin.

## Derlemek

Android Studio'da **bu klasörü** (`android/`) açın ya da terminalden:

```bash
cd android && ./derle.sh
```

`derle.sh`, Android Studio'nun kendi Java'sını bulup `./gradlew assembleDebug` çalıştırır. Çıktı: `app/build/outputs/apk/debug/app-debug.apk`. Diğer görevler:

| Komut | Çıktı |
| --- | --- |
| `./derle.sh :app:testDebugUnitTest` | Birim testleri (HTTP ayrıştırma, sayfa gömme, ağ yardımcıları) |
| `./derle.sh assembleRelease` | Arkadaşlara gönderilecek imzalı APK: `app/build/outputs/apk/release/app-release.apk` |
| `./derle.sh bundleRelease` | Play'e yüklenecek paket: `app/build/outputs/bundle/release/app-release.aab` |

Çekirdeğin Node testleri depo kökünde `npm test` ile çalışır (`tests/android.test.js`).

## İmza anahtarı

Sürüm imzası depo **dışında**, `~/Okey101-imza/` klasöründedir (`okey101.jks`, `imza.properties`, şifrenin yazdığı `SIFRE-VE-YEDEK-OKU.txt`). Bu klasör yedeklenmelidir: anahtar kaybolursa Play'deki uygulama güncellenemez. Klasör yoksa sürüm imzasız derlenir.

## Telefona kurmak

```bash
~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Telefonda **Geliştirici seçenekleri → USB hata ayıklama** açık olmalı. APK dosyasını WhatsApp ya da AirDrop benzeri bir yolla gönderip telefonda açarak da kurulur ("bilinmeyen kaynaklardan yükleme" izni istenir).

## Google Play'e yüklemek

1. [play.google.com/console](https://play.google.com/console) → geliştirici hesabı (tek seferlik 25 $). Kişisel hesapta kimlik doğrulaması istenir.
2. **Uygulama oluştur**: ad `101 Okey · Pişti`, dil Türkçe, uygulama (oyun), ücretsiz.
3. **Mağaza girişi**: metinler `docs/magaza/magaza-metinleri.md`, simge `docs/magaza/simge-512.png`, öne çıkan görsel `docs/magaza/one-cikan-1024x500.png`, ekran görüntüleri `docs/magaza/ekran-*.png`.
4. **Uygulama içeriği** sayfalarındaki formlar: cevaplar `docs/magaza/play-console-cevaplar.md`. Gizlilik politikası: `https://ahmetemreozumagi.github.io/Okey_101/gizlilik.html` (GitHub Pages `/docs` klasöründen açılmalı).
5. **Test → Kapalı test**: yeni sürüm → `app-release.aab` yükle → test kullanıcıları listesi (e-posta ile en az 12 kişi) → yayınla. Testçiler katılma linkiyle uygulamayı Play'den kurar. Kişisel hesaplarda **12 testçi 14 gün** şartı vardır.
6. 14 gün sonra **Üretime erişim başvurusu** → onaylanınca **Üretim** sekmesinden aynı .aab ile yayınlanır. İnceleme birkaç gün sürebilir.

## İleride (targetSdk 37)

Android 17'de yerel ağ erişimi için `ACCESS_LOCAL_NETWORK` izni targetSdk 37'de zorunlu olur. Eklenecek yer `AndroidManifest.xml` içinde NOT olarak işaretlidir; izin çalışma zamanında "Masa kur" ve "Arkadaşına bağlan" düğmelerinde istenmelidir.
