import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RadialGradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Uygulama simgelerini ve mağaza görsellerini üretir (public/icon.png'deki iki okey taşı: 10 kırmızı, 1 mavi).
 *
 *   java -Djava.awt.headless=true android/tools/SimgeUret.java [res klasörü] [mağaza klasörü]
 *
 * Çıktılar:
 *   res/mipmap-*\/ic_launcher.png, ic_launcher_round.png   eski Android (7.0-7.1) için düz simgeler
 *   res/mipmap-*\/ic_launcher_foreground.png                uyarlanabilir simgenin ön planı (108 dp, saydam)
 *   docs/magaza/simge-512.png                               Play Console mağaza simgesi
 *   docs/magaza/one-cikan-1024x500.png                      Play Console öne çıkan görsel
 */
public class SimgeUret {
    static final Color CUHA = new Color(0x1A5E40), CUHA_KOYU = new Color(0x0F3B28), CUHA_ACIK = new Color(0x25784F);
    static final Color FILDISI = new Color(0xF8F2DF), FILDISI_GOLGE = new Color(0xE6D9B5), FILDISI_ACIK = new Color(0xFFFDF6);
    static final Color KIRMIZI = new Color(0xC8102E), MAVI = new Color(0x1356AD), PIRINC = new Color(0xE3B04B);

    public static void main(String[] a) throws Exception {
        File res = new File(a.length > 0 ? a[0] : "android/app/src/main/res");
        File magaza = new File(a.length > 1 ? a[1] : "docs/magaza");
        String[] dpi = { "mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi" };
        double[] olcek = { 1, 1.5, 2, 3, 4 };
        for (int i = 0; i < dpi.length; i++) {
            File k = new File(res, "mipmap-" + dpi[i]);
            k.mkdirs();
            int s48 = (int) Math.round(48 * olcek[i]);
            int s108 = (int) Math.round(108 * olcek[i]);
            yaz(duzSimge(s48, false), new File(k, "ic_launcher.png"));
            yaz(duzSimge(s48, true), new File(k, "ic_launcher_round.png"));
            yaz(onPlan(s108), new File(k, "ic_launcher_foreground.png"));
        }
        magaza.mkdirs();
        yaz(duzSimge(512, false), new File(magaza, "simge-512.png"));
        yaz(oneCikan(1024, 500), new File(magaza, "one-cikan-1024x500.png"));
        System.out.println("Simgeler üretildi: " + res + " ve " + magaza);
    }

    static void yaz(BufferedImage img, File f) throws Exception {
        ImageIO.write(img, "png", f);
    }

    static Graphics2D g2(BufferedImage img) {
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
        return g;
    }

    /** Çuha arka planı (ortası açık, kenarları koyu) */
    static void cuha(Graphics2D g, int w, int h) {
        g.setPaint(new RadialGradientPaint(new Point2D.Double(w * .5, h * .42), (float) (Math.max(w, h) * .75),
            new float[] { 0f, .55f, 1f }, new Color[] { CUHA_ACIK, CUHA, CUHA_KOYU }));
        g.fillRect(0, 0, w, h);
    }

    /** Uyarlanabilir simge ön planı: saydam zemin, taşlar güvenli bölgede (ortadaki 66/108) */
    static BufferedImage onPlan(int s) {
        BufferedImage img = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = g2(img);
        double w = s * .245, h = w * 1.36;
        tas(g, s * .415, s * .50, w, h, -8, "10", KIRMIZI);
        tas(g, s * .60, s * .50, w, h, 6, "1", MAVI);
        g.dispose();
        return img;
    }

    /** Düz (eski tip) simge ve mağaza simgesi: çuha zemin, yuvarlak köşe ya da daire */
    static BufferedImage duzSimge(int s, boolean yuvarlak) {
        BufferedImage img = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = g2(img);
        if (yuvarlak) g.setClip(new Ellipse2D.Double(0, 0, s, s));
        else g.setClip(new RoundRectangle2D.Double(0, 0, s, s, s * .22, s * .22));
        cuha(g, s, s);
        double w = s * .33, h = w * 1.36;
        tas(g, s * .395, s * .515, w, h, -8, "10", KIRMIZI);
        tas(g, s * .63, s * .515, w, h, 6, "1", MAVI);
        g.dispose();
        return img;
    }

    /** Play Console öne çıkan görseli: solda taşlar, sağda başlık */
    static BufferedImage oneCikan(int w, int h) {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = g2(img);
        cuha(g, w, h);
        double tw = h * .36, th = tw * 1.36;
        tas(g, w * .19, h * .50, tw, th, -9, "10", KIRMIZI);
        tas(g, w * .31, h * .52, tw, th, 7, "1", MAVI);
        // Yazılar sağdaki alana sığacak şekilde ölçeklenir
        int x = (int) (w * .44), genislik = (int) (w * .53);
        g.setColor(FILDISI);
        g.setFont(sigdir(g, "101 Okey · Pişti", Font.BOLD, (int) (h * .19), genislik));
        g.drawString("101 Okey · Pişti", x, (int) (h * .46));
        g.setColor(new Color(0xD8E9DF));
        g.setFont(sigdir(g, "101 Okey · Pişti · Renk · botlarla", Font.PLAIN, (int) (h * .085), genislik));
        g.drawString("Arkadaşlarla, internetsiz", x, (int) (h * .60));
        g.drawString("101 Okey · Pişti · Renk · botlarla", x, (int) (h * .71));
        g.dispose();
        return img;
    }

    /** Yazı verilen genişliğe sığmıyorsa yazı tipini küçültür */
    static Font sigdir(Graphics2D g, String yazi, int stil, int boyut, int genislik) {
        Font f = new Font(Font.SANS_SERIF, stil, boyut);
        while (boyut > 8 && g.getFontMetrics(f).stringWidth(yazi) > genislik) {
            boyut -= 2;
            f = new Font(Font.SANS_SERIF, stil, boyut);
        }
        return f;
    }

    /** Bir okey taşı: fildişi gövde, üstte sayı, altta renkli nokta */
    static void tas(Graphics2D g, double cx, double cy, double w, double h, double aci, String yazi, Color renk) {
        AffineTransform eski = g.getTransform();
        g.translate(cx, cy);
        g.rotate(Math.toRadians(aci));
        double r = w * .16;
        // gölge
        g.setColor(new Color(0, 0, 0, 90));
        g.fill(new RoundRectangle2D.Double(-w / 2 + w * .02, -h / 2 + h * .05, w, h, r, r));
        // gövde
        g.setPaint(new GradientPaint(0f, (float) (-h / 2), FILDISI_ACIK, 0f, (float) (h / 2), FILDISI_GOLGE));
        RoundRectangle2D govde = new RoundRectangle2D.Double(-w / 2, -h / 2, w, h, r, r);
        g.fill(govde);
        g.setColor(new Color(255, 255, 255, 170));
        g.setStroke(new BasicStroke((float) Math.max(1, w * .02)));
        g.draw(new RoundRectangle2D.Double(-w / 2 + w * .02, -h / 2 + w * .02, w - w * .04, h - w * .04, r, r));
        // sayı
        g.setColor(renk);
        Font f = new Font(Font.SANS_SERIF, Font.BOLD, (int) Math.round(yazi.length() > 1 ? w * .56 : w * .62));
        g.setFont(f);
        FontMetrics fm = g.getFontMetrics();
        int tw = fm.stringWidth(yazi);
        g.drawString(yazi, (int) Math.round(-tw / 2.0), (int) Math.round(-h * .5 + h * .12 + fm.getAscent() * .92));
        // nokta
        double d = w * .17;
        g.fill(new Ellipse2D.Double(-d / 2, h * .5 - h * .13 - d, d, d));
        g.setTransform(eski);
    }
}
