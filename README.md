# 101 Okey

Arkadaşlarla telefondan oynanan 4 kişilik **101 Okey**. Oyunu bir bilgisayar açar (Mac, Windows ya da Linux), herkes telefonundan ya da tabletinden **tarayıcıyla** girer. Telefonlara uygulama kurulmaz; Android, iPhone, tablet ve bilgisayar aynı masada oynar.

![Oyun ekranı](docs/oyun.jpg)

## Özellikler

- **Her ağdan oynanır:** internet linkiyle herkes kendi yerinden girer; biri evin Wi-Fi'ında, biri hotspot'ta, biri mobil veride olabilir. İsterseniz internetsiz, aynı Wi-Fi'dan da oynanır.
- **QR kodla giriş:** bilgisayardaki sayfada çıkan kodu telefon kamerasıyla okutmak yeter.
- **Oyun modları:** eşli / eşsiz, katlamalı (eşine katlanmaz), hamle süresi (20–60 sn ya da süresiz), el sayısı.
- **Kolay ıstaka:** dizili perlerin toplamı ıstakanın köşesinde yazar; yetince tek dokunuşla açılır. "Seri diz" ve "Çift diz" perler arasında boşluk bırakarak dizer. Yandan alınan taş işe yarayacağı yere kendiliğinden yerleşir.
- **Kopmaya dayanıklı:** telefonun bağlantısı koparsa kendiliğinden yeniden bağlanır. Oyun kapanıp açılsa da kaldığı yerden devam eder.
- **Kurallar oyunda kontrol edilir:** açış puanı, işleme, okey ve ceza puanları, el sonu hesabı.
- **Kurulum derdi yok:** sadece Node.js gerekir; `npm install` yok, ek paket yok.

## Gereken

- **Oyunu açacak bilgisayarda Node.js** (ücretsiz, bir kere kurulur): [nodejs.org](https://nodejs.org) adresinden **LTS** sürümünü indirip kurun.
- **Oyuncularda sadece bir tarayıcı** (Chrome, Safari, Samsung Internet...).

## Kurulum

**Kolay yol:** bu sayfada yeşil **Code** düğmesi → **Download ZIP**, sonra zip'i açın. Klasörün adı `Okey_101-main` olur.

**Git ile:**

```
git clone https://github.com/AhmetEmreOzumagi/Okey_101.git
cd Okey_101
```

## Başlatma

1. Oyun klasöründe bir terminal açın:
   - **Windows:** klasörü açın, üstteki adres çubuğuna `cmd` yazıp Enter'a basın.
   - **Mac:** Terminal'i açın, `cd ` yazın (sonunda bir boşluk), klasörü Terminal penceresine sürükleyip Enter'a basın.
2. Şunu yazın:

   ```
   node baslat.js link
   ```

3. Bilgisayarda oyun sayfası açılır, birkaç saniye içinde internet linkinin **QR kodu** çıkar. Arkadaşlarınız kodu okutur ya da linki WhatsApp'tan atarsınız.
4. Herkes adını yazıp masada boş bir sandalyeye dokunur. Ayarlardan modu seçin; dört kişi olunca **Oyunu başlat**.

Pencere açık kaldıkça oyun ve link çalışır. Kapatınca oyun durur; tekrar açınca kaldığı yerden devam eder.

| Komut | Ne zaman |
| --- | --- |
| `node baslat.js link` | **En kolayı.** Herkes her ağdan girer, aynı Wi-Fi şart değil. İnternet gerekir. |
| `node baslat.js` | Herkes aynı Wi-Fi'dayken, internetsiz. Telefonlar bilgisayarın yerel adresine girer (örn. `192.168.1.34:8101`). |

`npm run link` ve `npm start` de aynı işi yapar. Diğer seçenekler: `--port 9000` (başka port), `--tarayici-acma` (bilgisayarda sayfayı açma).

### Çift tıklayarak

Terminal istemeyenler için klasörde hazır dosyalar var:

| | İnternet linkiyle | Aynı Wi-Fi'dan |
| --- | --- | --- |
| **Windows** | `Windows - Internetten Oyna.bat` | `Windows - Oyunu Baslat.bat` |
| **Mac** | `Mac - Internetten Oyna.command` | `Mac - Oyunu Baslat.command` |

Windows'taki dosyalar Node.js kurulu değilse kurmayı da teklif eder. İnternetten indirilen dosyaları sistem ilk seferde engelleyebilir:

- **Windows** "Windows bilgisayarınızı korudu" derse **Ek bilgi → Yine de çalıştır**; "Yayımcı doğrulanamadı" derse **Çalıştır**.
- **Mac** dosyayı açmazsa klasörde açtığınız terminalde bir kere `xattr -cr . && chmod +x *.command` çalıştırın, ya da doğrudan `node baslat.js link` kullanın.

## Oyun içinde

- Telefonu yan çevirin. Menüden (☰) **Tam ekran** seçilebilir. iPhone'da tam ekran için Safari'de **Paylaş → Ana Ekrana Ekle**, sonra ana ekrandaki simgeden açın.
- **Çekmek:** desteye dokunun ya da soldaki oyuncunun attığı taşa dokunup alın. Yandan aldığınız taşla açamazsanız **Geri bırak**.
- **Dizmek:** taşı sürükleyerek ıstakada yerini değiştirin ya da **Seri diz** / **Çift diz**.
- **Açmak:** ıstakanın sağ üstündeki toplam yetince yeşil olur (ör. `108 / 101`); **Aç**'a basınca dizili perlerin hepsi birden açılır. Açtıktan sonra **İndir** yeni dizdiğiniz perleri masaya koyar.
- **İşlemek:** taşı masadaki pere sürükleyin ya da taşı seçip pere dokunun.
- **Atmak:** taşı sağ alttaki **At** kutusuna sürükleyin ya da seçip **At**.
- Elinizdeki okey ters (yeşil sırtı görünür) durur; sahte okey, temsil ettiği taş olarak ✿ işaretiyle görünür. Ortada sadece gösterge vardır.
- Süre dolarsa taş otomatik çekilip atılır.
- Telefon kapanırsa sayfayı yenileyin; başka telefona geçtiyseniz aynı adı yazmanız yeterli. Bağlanma adresi ve QR kod menüde (☰) de var.

## Kurallar

- Herkese 21, başlayana 22 taş dağıtılır. Başlayan çekmeden bir taş atar.
- **Okey**, göstergenin bir fazlasıdır (gösterge 13 ise okey 1) ve her taşın yerine geçer. İki **sahte okey** ise okey olan taşın kendisi olarak (o renk ve sayı) kullanılır.
- **Seri:** aynı renk, ardışık, en az 3 taş (12-13-1 olmaz). **Grup:** aynı sayı, farklı renk, 3 ya da 4 taş.
- **Açış:** tek seferde en az **101 puanlık** seri/grup ya da en az **5 çift**. Seriyle açan çift indiremez; çiftle açan yeni seri kuramaz ama işleyebilir.
- Yandan aldığınız taşı aynı anda açışta ya da işlemede kullanmanız gerekir.
- **Katlamalı** (açıksa): sonra açan, rakibinin açtığından en az 1 fazlasıyla açar; çiftte de 1 çift fazla gerekir. **Eşine katlanmaz:** siz 130 açtıysanız eşiniz yine 101 ile açabilir.
- **Eşli** (açıksa): karşılıklı oturanlar eştir. Biri bitince eşinin el cezası silinir. Puanlar takım olarak toplanır.
- Okey atmak ya da masadaki bir pere işlenebilecek taşı atmak: **+101 ceza**.
- **El sonu:** biten -101 alır. Açanlar elde kalan taşların toplamını, çiftle açanlar iki katını, hiç açmayanlar 202 yazar. Okey atarak ya da çiftten bitilirse herkesin puanı iki katına çıkar. Kimse açmadan tek seferde tüm elini indirip biten -202 alır, diğerleri 404 yazar.
- Deste biterse el puansız biter; sadece elinde okey olan okey başına 101 ceza yer.
- Seçilen el sayısı bitince toplamı **en düşük** olan (eşlide en düşük takım) kazanır.

## İnternet linki nasıl çalışıyor?

`link` modu Cloudflare'in ücretsiz, hesap gerektirmeyen geçici tünelini kullanır. Bağlantı aracı (`cloudflared`, yaklaşık 20 MB) ilk seferde oyun klasöründeki `bin/` içine iner; bilgisayara bir şey kurulmaz. Araç inmezse ya da Cloudflare cevap vermezse başlatıcı kendiliğinden **localhost.run** (ssh) yedeğine geçer.

- Link her açılışta yenidir (`https://...trycloudflare.com`). Bağlantı koparsa yeniden bağlanır; link değişirse oyun sayfasındaki QR da değişir, oyuncular yeni linke girip aynı adı yazar.
- Oyunu açan herkes kendi linkini alır; kimse başkasının bilgisayarına bağlanmaz.
- Linki bilen herkes masaya oturabilir; sadece arkadaşlarınızla paylaşın.
- Oyun çok az veri harcar.

## Sorun çıkarsa

- **`node` tanınmıyor / bulunamadı:** Node.js'i kurun, terminali kapatıp yeniden açın.
- **Aynı Wi-Fi'da bazı telefonlar giremiyor:** telefon hotspot'ları, yurt/okul/kafe ağları ve modemlerin misafir ağları cihazları birbirinden ayırır. `node baslat.js link` ile girin.
- **Windows'ta telefonlar yerel adrese giremiyor:** Güvenlik Duvarı sorduysa "Erişime izin ver" deyin; Wi-Fi ağ profili **Özel ağ** olmalı (Ayarlar → Ağ ve internet → Wi-Fi).
- **Link açılmıyor:** internet bağlantısını kontrol edin. Sürmezse `bin` klasörünü silip yeniden başlatın (araç yeniden iner).
- **Port dolu:** `node baslat.js link --port 9000`
- **Bağlantı sık kopuyor:** oyun açıkken bilgisayar uyumaz (Mac ve Windows), ama dizüstünün kapağını kapatmayın.

Daha ayrıntılı Türkçe kılavuz: [NASIL OYNANIR.txt](NASIL%20OYNANIR.txt)

## Geliştirenler için

| Dosya | Ne işe yarar |
| --- | --- |
| `baslat.js` | Başlatıcı: oyunu açar, `link` ile tüneli kurar, bilgisayarın uyumasını engeller |
| `server.js` | HTTP sunucusu; anlık güncellemeler SSE ile, kesilirse yoklama ile |
| `game.js` | Masa, sıra, süre, açış/işleme/ceza ve puan hesabı (bütün kurallar sunucuda) |
| `public/engine.js` | Taş, seri/grup/çift kontrolü ve ıstaka dizme (sunucu ve telefon ortak kullanır) |
| `public/` | Telefonlarda açılan tek sayfalık arayüz (`app.js`, `style.css`, `qr.js`) |
| `tests/` | Kural testleri, 200 oyunluk simülasyon ve HTTP testi |

```
npm test
```

Sadece Node'un kendi modülleri kullanılır. Oyun sırasında oluşan `oyun-kaydi.json`, `internet-linki.txt` ve `bin/` depoya girmez (`.gitignore`).
