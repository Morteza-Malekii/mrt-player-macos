# MRT-Player · macOS

Kendi kullanım hakkınız olan Xtream hesabıyla çalışan yerel IPTV oynatıcı.
Hazır kanal, film, dizi, abonelik veya IPTV kaynağı içermez. Apple Silicon Mac
için Electron + React + TypeScript ile üretilir. TV sürümü ayrı `webOs` deposundadır.

## Başlatma

Node 22 ve npm 10 ile test edildi. macOS Apple Silicon gerekir.

```sh
npm ci
npm start
```

İlk açılışta sunucu adresinizi (`https://sunucu:port` veya yetki verdiğiniz
`http://sunucu:port`), kullanıcı adınızı ve şifrenizi **uygulama ekranına** girin.
HTTP kullanımı için açık metin aktarımını ekrandan onaylamanız gerekir.
Giriş bilgilerini `.env`, komut satırı, kod veya test dosyasına yazmayın.

## Kurulabilir uygulama

```sh
npm run package
open 'release/MRT-Player-darwin-arm64/MRT-Player.app'
```

`release/MRT-Player-darwin-arm64/MRT-Player.app` oluşturulur. Paket yerel
geliştirme için ad hoc imzalanır; Apple Developer notarizasyonu yoktur. İlk
açılışta macOS engellerse Finder'da uygulamaya Control tuşuyla tıklayıp **Aç**
seçin. Ad hoc imza güncellemelerde değişebileceğinden Anahtar Zinciri yeniden
izin isteyebilir; bu durumda uygulama giriş ekranından hesabı tekrar ekleyin.
Uygulama simgesi `assets/MRT-Player.icns` olarak sürümlenir; yeniden üretmek yalnızca
simgeyi değiştirmek isterseniz Python/Pillow ile `python3 scripts/icons.py` gerekir.
Önceki kurulumdaki hesap ve ayarları korumak için mevcut uygulama veri dizini ve
macOS paket kimliği kullanılmaya devam eder.

## Kullanım

Sol menüden Canlı TV, Filmler, Diziler, Favoriler, Son izlenenler veya Ayarlar'ı
seçin. Kategori ve arama listesinden kanal açın. Filmler ayrıntı sayfasından,
diziler sezon/bölüm listesinden açılır. EPG verisi hesabın Xtream kısa program
rehberinden alınır. Sağdaki oynatıcı tam ekrana geçebilir; VOD içinde sarma,
ses ve duraklatma vardır. Alanlar arasında Tab, seçim için Enter; `Esc` geri,
`F` tam ekran, `M` sessiz, boşluk oynat/duraklat kullanılır.

Herhangi bir kategoriyi (örneğin yetişkin kanalları) kilitlemek için kategori
adının yanındaki kilit simgesine tıklayın. İlk kilitte 4–8 haneli bir PIN belirlenir.
Kilitli liste; kategori, **Tüm içerikler**, arama, favoriler ve son izlenenlerde
PIN girilene kadar gizlenir. PIN tüm kilitli listeleri açar; soldaki **Listeleri
yeniden kilitle** veya uygulamadan çıkış tekrar gizler. Ayarlar → Liste kilidi
altında PIN değiştirilir, tüm kilitler kaldırılır. PIN unutulursa hesabı cihazdan
silmek tek sıfırlama yoludur. Bu özellik çocuk ve ev içi gizlilik içindir.

Ayarlar → **Kanal ve film afişlerini göster** açılırsa kanal ve film listelerinde
sağlayıcının verdiği logo veya afiş adın yanında görünür; görsel yoksa veya yüklenemezse kanalın baş harfleri gösterilir. Görseller
sayfaya değil ana sürece indirilir ve sayfa yalnızca opak `kiyi://image/...` adresini
görür.

Büyük listelerde uygulama önce ilk kategoriyi yükler; tüm kataloğu görmek veya
genel arama yapmak için **Tüm içerikler**'i seçin. Oynatma ayarı yoktur: canlı
yayın HLS olarak hls.js ile, geniş tamponla açılır; film paralel indirmeyi hesabın
bağlantı sınırına göre kendisi belirler. Kesinti olursa oynatıcıdaki **Akış
bilgisi** düğmesiyle çözünürlük, ön tampon, atlanan kare ve kesinti sayısını
kontrol edin. Sonuç sunucunun verdiği akışa, ağ hızına ve videonun codec'ine bağlıdır.

Hesap kaydı isteğe bağlıdır. Kaydedilen hesap Electron `safeStorage` ile macOS
Anahtar Zinciri anahtarı kullanılarak şifrelenir. Kategori favorileri, izleme
geçmişi ve ayarlar yerel uygulama veri dizininde tutulur. Oynatıcıya hesap URL'si
aktarılmaz; Mac ana süreç HLS ve VOD verisini opak medya adresleriyle iletir.
Hiçbir uzak MRT-Player sunucusu yoktur; ağ bağlantısı yalnızca girdiğiniz Xtream
sunucusuna, sağlayıcının medya yönlendirmelerine ve **afişler açıksa** sağlayıcının
listede verdiği görsel adreslerine yapılır. Afişler **varsayılan olarak kapalıdır**;
siz açmadıkça sağlayıcı dışında hiçbir siteye bağlanılmaz. Açarsanız bu adresler
çoğu zaman aynı sunucudadır ama başka bir CDN veya üçüncü taraf bir görsel sitesi
de olabilir; o durumda o site IP adresinizi ve hangi listeyi açtığınızı görür.
Uygulama telemetri, istatistik veya hata raporu göndermez ve günlük dosyası tutmaz.

## Doğrulama ve geliştirme

```sh
npm run check
npm run test:integration
npm run test:e2e
npm run test:4k
npm run test:switch
npm run test:recover
npm run test:lanes
npm run test:solo
npm run test:cushion
npm run test:cushion:safety
npm run test:rate
npm run test:keychain
npm run test:lock
npm run test:posters
npm run test:packaged
npm run test:4k:packaged
```

Testler rastgele kimlikli, loopback Xtream sunucusu ve yalnızca yerelde üretilen
12 saniyelik test videosu kullanır. `test:e2e`, gerçek Electron penceresinde
girişten videoya, EPG'ye, VOD ve dizi kontrollerine kadar akışı otomatik dener.
`test:4k`, yerel 3840×2160 HLS test yayınında oynatmanın ilerlemesini, kare
kaybını ve bilgi panelini kontrol eder. `test:switch`, kanal değişiminin
süresini ve havuzdaki sunucu bağlantısının yeniden kullanılıp kullanılmadığını
ölçer. `test:recover`, bant genişliği sınırlandırılmış kayan pencereli canlı bir
yayında bağlantıyı koparıp kanalın kendi kendine dönmesini, sunucu tamamen
kapandığında da kullanıcının bilgilendirilmesini dener. Test medyası ve sonuçları
üretim `.app` içine girmez. Bu testler, gerçek sağlayıcının 4K yayınını ölçmez.

Ortak kod `src/core`, `src/runtime`, `src/ui` altındadır. TV deposuyla aynı
sürümlü kopyalar ayrı depolarda tutulur. Bu sürümde Mac oynatma iyileştirmeleri
TV'ye henüz taşınmadığından `npm run shared:check` fark gösterir. TV çalışmasına
yeniden başlandığında ortak modüller gözden geçirilerek eşitlenmelidir. Her depo
tek başına `npm ci` ve build ile çalışır. Mimari/aşama kaydı
[docs/PLAN.md](docs/PLAN.md), test sınırları [docs/VALIDATION.md](docs/VALIDATION.md)
içindedir.
