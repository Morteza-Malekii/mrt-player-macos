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

Listeler Ayarlar → **Listeleri yönet** bölümünden yönetilir. Canlı TV, film ve dizi
kategorilerinin her biri üç durumdan birinde olur: **Görünür**, **Kilitli** veya
**Gizli**. Gizli liste ve içeriği hiçbir yerde (liste, **Tüm içerikler**, arama,
favoriler, son izlenenler) gösterilmez. Kilitli liste adıyla görünür ama içeriği
PIN girilene kadar gizlidir; ilk kilitte 4–8 haneli bir PIN belirlenir. PIN tüm
kilitli listeleri açar; soldaki **Listeleri yeniden kilitle** veya uygulamadan çıkış
tekrar gizler. PIN belirlendikten sonra kilitli ya da gizli bir listeyi tekrar
**Görünür** yapmak da PIN ister; kilitlemek ve gizlemek istemez. Ayarlar → Liste
kilidi altında PIN değiştirilir, tüm kilitler kaldırılır. PIN unutulursa hesabı
cihazdan silmek tek sıfırlama yoludur. Bu özellik çocuk ve ev içi gizlilik içindir.

Sıralamayı siz belirlersiniz. Listelerin sırası Ayarlar → **Listeleri yönet**'te
oklarla (başa al, yukarı, aşağı) değiştirilir; ilk sıradaki liste Canlı TV, Filmler
veya Diziler açıldığında ilk görünen olur. Bir listenin içindeki kanalları veya
filmleri değiştirmek için liste başlığındaki **Sırala** düğmesine basın; kartlar
oynatmak yerine başa al, öne al ve geriye al düğmelerini gösterir. **Favoriler**
de aynı şekilde sıralanır. Arama yazarken sıralama kapanır. Sıra yalnızca bu
cihazda, hesabın kitaplığında saklanır; **Sırayı sıfırla** sağlayıcının sırasına
döner. Yalnızca sizin düzenlediğiniz kısım saklanır, sağlayıcı yeni kanal eklerse
bunlar düzenlediğiniz kanalların ardından görünür.

Kanallar, filmler ve diziler kutucuk (kart) ızgarasında gösterilir: ad kartın alt
kenarındadır, filmlerde puan köşede görünür. Ayarlar → **Kanal ve film afişlerini
göster** açılırsa kartlar sağlayıcının verdiği logo veya afişle dolar; görsel yoksa veya yüklenemezse kanalın baş harfleri gösterilir. Görseller
sayfaya değil ana sürece indirilir ve sayfa yalnızca opak `kiyi://image/...` adresini
görür.

Film ve dizi bölümlerinde oynatıcının sağ altındaki **Ses ve altyazı** düğmesi
bir menü açar. **Ses** altında dosyadaki dublaj/dil parçaları (Türkçe, İngilizce,
Farsça...) listelenir; seçtiğiniz dil hatırlanır ve o dilde parçası olan sonraki her
film ve bölüm onunla başlar. AC-3, E-AC-3 ve DTS sesler macOS'taki Chromium'da
çözülemediği için listelenmez; bu codec'lerle yayımlanmış bir dublaj görünmez.
**Altyazı** altında **Altyazı dosyası yükle…** ile bilgisayarınızdan bir `.srt` ya da
`.vtt` dosyası seçilir (UTF-8, Türkçe windows-1254 ve Farsça windows-1256 dosyalar
okunur); altyazı görüntünün üstünde çıkar, **Kapalı** ile gizlenir. Dosyanın içine
gömülü altyazılar gösterilemez, çünkü Chromium bunları sayfaya vermez. Yüklenen
altyazı yalnızca o oynatma için geçerlidir. Canlı yayında bu düğme yoktur.

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
npm run test:order
npm run test:tracks
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
