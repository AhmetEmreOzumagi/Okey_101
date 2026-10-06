# WebView'den çağrılabilen Kotlin metodları adlarıyla kalsın
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# Hata kayıtlarında satır numaraları okunabilsin
-keepattributes SourceFile,LineNumberTable
