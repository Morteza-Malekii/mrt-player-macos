# MRT-Player geliştirme planı

İki bağımsız depo: `macOs` ve `webOs`. Harici backend, içerik servisi veya deploy yok.
Hedef: kullanıcının kendi Xtream hesabı; paketlerde hazır IPTV listesi yok.

## Mimari kararları

- TypeScript strict, React 18, esbuild; React hooks/reducer ile durum yönetimi.
- `src/core`: platformdan bağımsız modeller, Xtream istemcisi, EPG normalizasyonu,
  koleksiyonlar ve tipli uygulama portu. HTTP, kasa, veri saklama ve video dışarıdan verilir.
- `src/runtime`: Node ortamına uygun HTTP taşıyıcısı ve oturum yöneticisi.
- `src/ui`: paylaşılan ekranlar; TV/masaüstü davranışı platform portundan gelir.
- `src/platform`: Electron IPC / webOS Luna adaptörleri ve ayrı oynatıcılar.
- Mac: yalıtılmış, sandbox renderer; main process API erişimi, safeStorage kasası,
  HLS manifestini de kapsayan opak medya URL'leri; canlı yayın sabit olarak
  hls.js ile açılır, oynatma için kullanıcıya seçenek sunulmaz.
- TV: paketlenmiş klasik JS (ES module yok), native HTML5/HLS; TV içinde çalışan
  JS servisi API erişimi sağlar. Node 8 uyumlu servis, Chromium 68+ arayüz;
  başlangıç hedefi webOS 5+. Şifreler PBKDF2 + AES-256-GCM ile kilit parolasına bağlı
  saklanır. Parola/anahtar saklanmaz; her yeni uygulama oturumunda kilit açılır.
- Ortak dosyalar her depoda sürümlü kopyadır. Sibling repo veya üçüncü repo olmadan
  build mümkündür. Eşitlik kontrolü ve açık senkronizasyon scripti drift'i yakalar.

## Aşamalar ve çıkış ölçütleri

1. Ortam: mevcut dosyalar, Git, Node, paketleme araçları ve cihaz erişimi incelemesi.
2. Mac dikey prototip: giriş → API kategorileri → kanallar → gerçek video elementinde
   oynatma. Yerel sentetik Xtream sunucusu, HLS test deseni, başarısız giriş testi.
3. Erken TV prototipi: aynı API akışı, yerel Luna servis sözleşmesi, native video,
   HTTP/HTTPS, CORS ve 37–40/13/461 kumanda kontrolleri. Donanım yoksa yerel test
   ve fiziksel cihaz testi açıkça ayrı raporlanır; donanım sonucu uydurulmaz.
4. Mac MVP: arama, favori, yakın geçmiş, EPG, film/dizi ayrıntıları ve bölümler,
   seek/ses/tam ekran; güvenli kasa; yerel tercihler; hata/boş/yükleniyor ekranları.
5. TV MVP: aynı çekirdek, büyük tipografi, odak geometrisi, geri yığını,
   Magic Remote pointer, medya tuşları, servis yaşam döngüsü ve kasa kilidi.
6. Doğrulama: API/EPG/model testleri, HTTPS/redirection/timeout testleri, şifreleme
   ve veri bozulma testleri; masaüstü ve TV etkileşim kontrolleri; paket denetimi.
7. Teslim: Apple Silicon `.app`, webOS `.ipk`, kısa Türkçe çalıştırma/kurulum rehberi,
   test kayıtları ve gerçek hesap/TV gerektiren kalan doğrulamaların açık listesi.

## Test verisi ve güvenlik

Test sunucusu yalnızca loopback üzerinde çalışır; geçici rastgele kimlik bilgileri
bellekte oluşturulur. Gerçek bilgiler kodda, fixture'da, komut satırında veya logda yoktur.
Sentetik renk/hareket video test deseni dışında medya pakete eklenmez; üretim
paketlerinde mock katalog/sunucu bulunmaz. Hatalar URL veya ham sunucu yanıtı içermez.
TLS doğrulaması kapatılmaz. HTTP hesaplarında açık metin taşıma arayüzde belirtilir.
İçerik kodlayıcısı/DRM aşılmaz; desteklenmeyen codec anlaşılır hata verir.

## Başlangıç incelemesi

- 2026-09-21: Her iki klasör boş; henüz `.git` yok.
- macOS arm64, Node 22.18.0, npm 10.9.3; webOS CLI ve ffmpeg PATH'te yok.
- TV modeli ve Developer Mode erişimi kullanıcıya soruldu; henüz doğrulanmadı.
