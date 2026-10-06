import java.util.Properties

// 101 Okey · Pişti — Android uygulaması.
// Oyun mantığı yeniden yazılmadı: depo kökündeki JS dosyaları (game.js, pisti.js, uno.js, bot.js, lib.js,
// public/engine.js) ve telefon arayüzü (public/) derleme sırasında uygulamanın assets klasörüne paketlenir.
// Böylece web sürümüyle uygulama aynı dosyalardan beslenir.
plugins {
    id("com.android.application")
}

// Sürüm imzası: anahtar depo DIŞINDA, ~/Okey101-imza/imza.properties içinde tarif edilir
// (storeFile, storePassword, keyAlias, keyPassword). Dosya yoksa sürüm imzasız derlenir.
val imzaDosyasi = File(System.getProperty("user.home"), "Okey101-imza/imza.properties")
val imza = Properties().apply { if (imzaDosyasi.isFile) imzaDosyasi.inputStream().use { load(it) } }

android {
    namespace = "io.github.ahmetemreozumagi.okey101"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.ahmetemreozumagi.okey101"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (imzaDosyasi.isFile) {
            create("surum") {
                storeFile = File(imza.getProperty("storeFile"))
                storePassword = imza.getProperty("storePassword")
                keyAlias = imza.getProperty("keyAlias")
                keyPassword = imza.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (imzaDosyasi.isFile) signingConfig = signingConfigs.getByName("surum")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Dış kütüphane yok: sadece Android çerçevesi ve Kotlin standart kütüphanesi.
    testImplementation("junit:junit:4.13.2")
}

// ---------- JS paketleme ----------
// Depo kökündeki oyun dosyalarını assets'e kopyalar:
//   assets/public/*  : telefonlarda açılan arayüz (HTTP sunucusu tek sayfa halinde sunar)
//   assets/host.js   : masa kuran telefonun gizli WebView'inde çalışan oyun çekirdeği
//                      (lib.js, engine.js, pisti.js, uno.js, game.js, bot.js, host-core.js tek dosyada)
// Aynı işi Node ile yapan betik: android/paketle.js (testler onu kullanır).
abstract class PaketleJs : DefaultTask() {
    @get:InputDirectory abstract val publicKlasoru: DirectoryProperty
    @get:InputFiles abstract val moduller: ConfigurableFileCollection
    @get:InputFile abstract val onsoz: RegularFileProperty
    @get:InputFile abstract val sonsoz: RegularFileProperty
    @get:OutputDirectory abstract val cikis: DirectoryProperty

    @TaskAction
    fun calistir() {
        val out = cikis.get().asFile
        out.deleteRecursively()
        val pub = File(out, "public")
        pub.mkdirs()
        publicKlasoru.get().asFile.listFiles()!!
            .filter { it.isFile && !it.name.startsWith(".") }
            .forEach { it.copyTo(File(pub, it.name)) }
        val sb = StringBuilder()
        sb.append("// ÜRETİLMİŞ DOSYA — elle değiştirmeyin. Kaynak: depo kökündeki JS dosyaları (bkz. app/build.gradle.kts).\n")
        sb.append(onsoz.get().asFile.readText())
        for (f in moduller.files.sortedBy { it.name }) {
            sb.append("\n__modul('").append(f.name).append("', function (module, exports, require) {\n")
            sb.append(f.readText())
            sb.append("\n});\n")
        }
        sb.append(sonsoz.get().asFile.readText())
        File(out, "host.js").writeText(sb.toString())
    }
}

val depoKoku = rootDir.parentFile!!
val paketleJs = tasks.register<PaketleJs>("paketleJs") {
    group = "okey"
    description = "Oyunun JS dosyalarını ve public/ arayüzünü assets'e paketler"
    publicKlasoru.set(File(depoKoku, "public"))
    moduller.from(
        File(depoKoku, "lib.js"),
        File(depoKoku, "public/engine.js"),
        File(depoKoku, "pisti.js"),
        File(depoKoku, "uno.js"),
        File(depoKoku, "game.js"),
        File(depoKoku, "bot.js"),
        File(rootDir, "host/host-core.js"),
    )
    onsoz.set(File(rootDir, "host/paket-onsoz.js"))
    sonsoz.set(File(rootDir, "host/paket-sonsoz.js"))
    cikis.set(layout.buildDirectory.dir("uretilen/assets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(paketleJs, PaketleJs::cikis)
    }
}
