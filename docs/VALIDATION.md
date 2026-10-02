# Doğrulama kaydı

## Dikey prototip

- Mac: TypeScript ve build geçti. Çekirdek birim testleri geçti.
- Mac: yerel, her çalıştırmada rastgele hesap üreten Xtream fixture ile kimlik
  doğrulama, kategoriler, kanallar, HLS playlist/parça, VOD Range isteği geçti.
- Mac: gerçek Electron penceresinde giriş → kategori → kanal → video geçti.
  Video 640×360 kare üretti ve `currentTime > 1` doğrulandı.
- Görsel kanıt (yerel, Git dışı): `test-results/mac-prototype.png`.
- TV: tip denetimi, Chromium 68 arayüz / Node 8 servis derlemesi geçti.
- TV: HTTP, CORS başlığı olmayan API, şifreli kasa, yanlış parola,
  yeniden kilit açma, geçersiz TLS sertifikası reddi testleri geçti.
- Fiziksel TV: henüz bağlanmadı. CLI listesinde yalnızca varsayılan localhost
  emulator tanımı var; çalışan bir TV/emulator kanıtı değildir.

## MVP ve paket doğrulaması

- Her iki UI'da arama (Türkçe küçük/büyük harf), boş kategori, favori ekleme,
  EPG içeriği, film ayrıntısı ve oynatımı, dizide sezon/bölüm seçimi, ileri/geri
  sarma, tam ekran, ses/sessiz, son izlenen ve ayar değişikliği otomatik geçti.
- Mac: kayıtlı hesap, macOS Anahtar Zinciri ile şifreleme, kilidi açma ve
  yerel hesabı silme gerçek Electron penceresinde geçti (`test:keychain`).
- TV: kilit parolasıyla AES-GCM kayıt, yanlış parola reddi, kilidi açma ve
  yerel hesabı silme UI + servis testinde geçti.
- TV: CORS başlığı olmayan test API'si tarayıcıdaki çapraz köken isteğini
  reddetti; aynı API'ye yerel servis erişimi geçti. Geçersiz TLS sertifikası
  reddedildi; test CA ile güvenilir HTTPS isteği geçti. HTTP ayrıca onay istedi.
- Mac: `.app` içindeki gerçek paketli yürütücü ayrı geçici profil ile açıldı;
  tam MVP uçtan uca testi geçti. Arm64 Mach-O ve ad hoc kod imzası doğrulandı.
- TV: `.ipk` LG CLI ile oluşturulup `ares-package -I` içinde uygulama ve JS
  servisinin ikisi de doğrulandı. `file://` arayüz WebKit ile açıldı ve native
  HLS video kareleri oynatıldı. Bu, gerçek LG TV medya motoru testi değildir.
- İki depoda 18 ortak dosya SHA-256 düzeyinde aynı (`npm run shared:check`).

## Büyük katalog ve yayın iyileştirmeleri · 0.1.2

- İlk katalog isteği tüm kanalları almak yerine ilk kategoriye yöneliyor; yerel
  fixture, ilk `get_live_streams` isteğinde `category_id` bulunduğunu doğruluyor.
- Mac Electron testinde hem HLS hem doğrudan MPEG-TS kanal açılışı, görüntü ve
  ses içeren yerel sentetik yayınla doğrulandı. HLS'de eski tampon sınırlandı.
- EPG isteği ilk video oynatma olayından sonra başlıyor. Kullanıcı isterse tüm
  kataloğu ayrıca açabiliyor.
- Kategoriye daraltılmış istek ve 50.000 canlı kanal, 40.000 film, 11.000
  diziden oluşan sentetik tam katalog yanıtı iki platformun HTTP katmanında
  işlendi. Bu test gerçek 4K akış performansını ölçmez.

## Mac oynatma iyileştirmeleri · 0.1.3

- Canlı HLS varsayılan olarak Electron/macOS yerel video oynatıcısına veriliyor.
  hls.js uyumluluk seçeneği ve MPEG-TS alternatifi ayarlarda kalıyor. Üç biçim
  de gerçek Electron penceresinde yerel test sunucusuyla açıldı.
- Canlı yayının sık `timeupdate` olayları artık React durumunu ve izleme
  geçmişini sürekli güncellemiyor. VOD konumu seyrek güncelleniyor ve yerel
  kayıt aralığı 30 saniye.
- Akış bilgisi panelinde çözünürlük, ön tampon, atlanan kare, ilk görüntü ve
  kesinti sayısı/süresi gösteriliyor. Hesap ve yayın adresi bu panelde yok.
- Yerelde üretilmiş 3840×2160 H.264/AAC, 16 Mbps hedefli HLS test akışı
  3 saniyede 3 saniye ilerledi; ölçülen örnekte 0/121 kare atlandı. Bu yalnızca
  bu Mac'teki sentetik test için geçerlidir; gerçek sağlayıcı yayını veya
  uzun süreli ağ kararlılığına ilişkin garanti değildir.
- Paketli 0.1.3 `.app` aynı 4K akışı 3 saniyede 3 saniye ilerletti; test
  son koşuda 0/123 kare atlandı. Paketli MVP akışı, Anahtar Zinciri testi,
  büyük katalog entegrasyonu, tip denetimi ve birim testleri geçti. Paket
  arm64 ve ad hoc imzalı; kod imzası doğrulandı.
- Bu aşamada yalnızca Mac değiştirildi. TV deposu önceki sürümde kaldı;
  platformlar arası ortak dosya eşitliği kontrolü bu sürüm için beklenmez.

## Kesinti ve kanal değişimi · 0.1.4

- Medya vekili, gövdesi akan bir yanıtı artık boşta kalma zaman aşımıyla
  kapatmıyor. Tamponu dolan her oynatıcı dakikalarca okumayı durdurur; eski
  davranışta bağlantı tam 15 saniyede kesiliyordu. Yerel ölçümde duraklatılan
  bir tüketici eski kodda 15,0 saniyede koptu, yeni kodda 20 saniyeyi aştı.
  Birim testi soketin akan yanıtta zaman aşımsız, tümü okunan katalog yanıtında
  15 saniyede kaldığını doğruluyor.
- Kanal değişiminde yalnızca adres jetonları değil, sağlayıcıya açık kalan
  yayın bağlantıları da kapatılıyor; böylece hesabın eşzamanlı bağlantı hakkı
  bir sonraki kanaldan önce serbest kalıyor (`tests/core.test.ts`).
- Oynatıcı kopan yayını sınırlı sayıda kendi başına yeniden deniyor; bütçe on
  saniyelik kesintisiz oynatmadan sonra yenileniyor. Kısa kesintilerde ekrana
  durum yazısı basılmıyor.
- Yayın başladıktan sonra tamamen ölen bir kanal artık sonsuza kadar "Yayın
  tamponlanıyor…" göstermiyor; yirmi saniye sonra yeniden deneme düğmesiyle
  birlikte açıklama çıkıyor.
- Fixture'a kayan pencereli canlı HLS modu eklendi; ENDLIST yok, playlist yalnızca
  yayınlanmış parçaları sunuyor. Bant genişliği sınırlandırılmış bu canlı akışta
  (`npm run test:recover`) iki ayrı bağlantı kesintisi hata ekranı olmadan
  toparlandı, sunucu tamamen kapatıldığında kullanıcı bilgilendirildi.
- Aynı test eski oynatıcı koduyla iki kez üst üste başarısız oldu: Chromium'un
  yerel HLS çözümleyicisi açılışta `DEMUXER_ERROR_COULD_NOT_PARSE` verdi ve
  yeniden deneme olmadığı için kanal kalıcı olarak "Video açılamadı" ekranında
  kaldı.
- Kanal değişimi ölçümü (`npm run test:switch`): bağlantı başına 150 ms gecikme
  benzetimiyle geçiş 640 ms sürdü ve havuzdaki bağlantı yeniden kullanıldığı için
  yeni sunucu bağlantısı açılmadı. Bu ölçüm bağlantı havuzunun çalıştığını
  gösterir; sağlayıcının yayını başlatma süresini kapsamaz.
- 4K, MVP, büyük katalog ve entegrasyon testleri bu değişikliklerden sonra
  yeniden geçti; sentetik 3840×2160 akış 3 saniyede 3 saniye ilerledi, 0/120
  kare atlandı.
- Bu bölümdeki ölçümler yerel sentetik yayınla yapıldı. Gerçek bir sağlayıcının
  4K kanalındaki kesinti davranışı ancak yetkili bir hesapla denenebilir.

## Akış teşhisi · 0.1.5

- Üç oynatıcı biçiminin de (yerel HLS, hls.js, MPEG-TS) aynı şekilde takılması
  sorunun oynatıcı motorunda değil, altındaki ortak yolda olduğunu gösterdi.
- `kiyi://` medya vekilinin aktarım hızı ölçüldü: kaynaktan doğrudan okumada
  857 MB/s, vekil üzerinden 641 MB/s (oranın %75'i, yaklaşık 5 Gbps). Vekil
  kodu bir darboğaz değil; 4K için gereken 25–40 Mbps'in çok üstünde.
- Bu nedenle ölçüm, uygulamanın içinden sağlayıcıya doğru taşındı. Akış bilgisi
  paneline sağlayıcıdan gelen anlık hız (Mbps), açık bağlantı sayısı, ilk bayta
  kadar geçen en yavaş süre ve sunucu hata sayısı/son HTTP kodu eklendi.
  Sayaçlar yalnızca sayıdır; adres, hesap veya yayın kimliği içermez.
- Ölçüm iki okuma arasındaki farktan türetiliyor; böylece görüntü tampondan
  akmaya devam ederken bile yavaşlayan sağlayıcı fark ediliyor.
- Panelin gerçek değer ürettiği Electron penceresinde doğrulandı (`test:e2e`).

## Sağlayıcı uyumluluğu · 0.1.6

- Kullanıcı aynı hesabın bazı uygulamalarda (TCL TV üzerinde 4K Player) kesintisiz
  oynadığını bildirdi. Bu, bant genişliğinin yeterli olduğunu ve farkın istemci
  davranışında olduğunu gösterir; ölçülen vekil hızı da darboğaz olmadığını
  doğrulamıştı.
- MPEG-TS yolundaki `liveBufferLatencyChasing` kaldırıldı. Bu seçenek tampon
  büyüdükçe ileri atlayarak gecikmeyi ~1,5 saniyede tutuyordu; yani sağlayıcı
  yavaşladığında sığınılacak tampon bırakmıyordu. Giriş yığını da büyütüldü.
- Sunucuya bildirilen oynatıcı (`User-Agent`) ayarlanabilir yapıldı: varsayılan,
  VLC, ffmpeg/Lavf ve tarayıcı ön ayarları. Serbest metin kabul edilmiyor;
  başlık enjeksiyonuna yer bırakmamak için yalnızca ön tanımlı değerler var.
  Seçimin gerçekten sunucuya ulaştığı Electron testinde doğrulandı: fixture,
  ayar değiştikten sonraki isteklerde `VLC/` ile başlayan başlığı gördü.
- Tampon tercihi eklendi (normal / büyük). Büyük seçenekte hls.js canlı kenardan
  yedi parça geriden başlıyor, MPEG-TS yığını 2 MB'a çıkıyor. Yerel HLS'de
  Chromium tamponu yönettiği için bu ayarın etkisi yoktur; arayüzde belirtildi.
- Bu ayarların hangisinin gerçek sağlayıcıda işe yaradığı buradan doğrulanamaz;
  yalnızca ayarların doğru uygulandığı doğrulandı.

## Codec teşhisi · 0.1.7

- Electron/Chromium'un ses codec desteği ölçüldü. Destekleniyor: AAC, Opus, FLAC.
  Desteklenmiyor: AC-3, E-AC-3, MP2, MP3 (mp4 içinde), DTS. Görüntüde H.264,
  HEVC ve AV1 var; MPEG-2 yok. TV'lerde Dolby çözücüsü lisanslı olarak bulunur,
  Chromium'da bulunmaz; aynı yayının TV'de akıcı, Mac'te sorunlu olmasının
  bilinen sebebi budur.
- Fixture'a ses codec'i seçeneği eklendi (`aac`/`ac3`/`eac3`/`mp2`) ve bildirilen
  arıza yerelde yeniden üretildi:
  - MP2 ses + yerel HLS: oynatma 12 saniyede yalnızca 5,1–5,2 saniye ilerledi
    (üç koşuda da aynı). Ses çözülüyor ama boru hattı gerçek zamana yetişemiyor.
    Aynı yayın HLS uyumlulukta 11,9, MPEG-TS'te 11,8 saniye ilerledi.
  - AC-3 / E-AC-3 ses: HLS yollarında görüntü oynuyor, çözülen ses baytı sıfır
    kalıyor (sessiz). MPEG-TS yolunda yayın hiç açılmıyor (0 px, 0 saniye).
- Donanım çözücü elendi: gerçek pencerede `video_decode: enabled`, Apple M3 Pro,
  Metal 4. İlk ölçümün `disabled_software` demesi, penceresiz probe'ta GPU
  sürecinin hiç başlamamasındandı.
- Akış bilgisi paneline "Ses çözümü" ve "Görüntü çözümü" satırları eklendi.
  Biri ilerlerken diğeri sıfırda kalıyorsa sorun ağ değil, codec desteğidir.
  Panelin gerçek değer ürettiği Electron testinde doğrulandı.

## Çözücü elendi, tavan hızı ölçülüyor · 0.1.8

- Kullanıcının paneli: 3840×2160 dosya, ön tampon 15,6 sn, atlanan kare 83/1020
  (%8,1), kesinti 12 kez · 78,2 sn, sunucu hızı 4,5 Mbps, en yavaş yanıt 1,6 sn,
  2/309 istek hatalı (son kod 206).
- Çözücü yerelde elendi: 3840×2160 test akışı H.264, HEVC ve HEVC 10-bit olarak
  üretildi; üçü de 15 saniyede 14,7–14,8 saniye oynadı ve **%0** kare atladı.
  Yani M3 Pro donanım çözücüsü 4K'yı rahat kaldırıyor; kullanıcının gördüğü
  %8,1 kare kaybı çözücü yetersizliği değil, kesintiden sonra toparlanmanın
  yan etkisi.
- "Sunucu hızı" tek başına yanıltıcı: tamponu dolan oynatıcı bilerek yavaşlar,
  bu yüzden 4,5 Mbps sağlayıcının tavanı değil olabilir. Panele "En yüksek hız"
  eklendi: 250 ms'lik pencerelerde görülen en iyi hız. Bu sayı yayının bit
  hızının altındaysa sağlayıcı yetişemiyor demektir.
- Pencere, panel her okuduğunda da kapatılıyor; yoksa bir sonraki parça gelmeden
  biten aktarım hiç sayılmıyordu (Electron testinde yakalandı ve düzeltildi).

## Paralel indirme · 0.1.9

- Kullanıcının ikinci paneli sorunu sayısallaştırdı: 3840×2160 dosya, ses çözümü
  1162 KB ve görüntü çözümü 112309 KB (yani codec sorunu yok), 1789 kare,
  ön tampon 19,4 sn, kesinti 19 kez · 135 sn, en yüksek hız 16,2 Mbps.
- Çözülen bayt ve kare sayısından içeriğin bit hızı hesaplandı: 24–30 fps için
  12,5–15,6 Mbps. Sağlayıcı tavanı 16,2 Mbps olduğuna göre pay yalnızca
  1,04–1,30 kat. Akıcı oynatma için 1,5–2 kat gerekir; tampon bu yüzden boşalıyor.
- Açık bağlantı sayısı 1'di. Sağlayıcıların hızı hesap başına değil **bağlantı
  başına** sınırlaması yaygındır. Fixture'a bağlantı başına hız sınırı eklendi ve
  varsayım ölçüldü: 1 bağlantı 15,9 Mbps, 2 bağlantı 31,8, 4 bağlantı 63,9,
  6 bağlantı 95,3 Mbps. Sınır bağlantı başına olduğunda hız doğrusal katlanıyor.
- Medya vekiline paralel indirme eklendi: sunucu Range'i onurlandırıyorsa (206 ve
  geçerli `content-range`) ve parça 8 MB'tan büyükse, dosya 2 MB'lık dilimlere
  bölünüp birkaç bağlantıdan aynı anda çekiliyor, oynatıcıya tek sıralı akış
  veriliyor. Uçuştaki dilim sayısı seçilen bağlantı sayısıyla sınırlı, yani
  bellek tüketimi sabit.
- Regresyon testi (`npm run test:lanes`): 13 Mbps'lik 4K dosya, bağlantı başına
  6 Mbps sınır. Tek bağlantı 40 saniyede yalnızca 17,4 saniye oynattı ve 6 kez
  kesildi; 4 bağlantı 37,0 saniye oynattı ve hiç kesilmedi. Test, tek bağlantının
  gerçekten takıldığını da doğruluyor; yoksa ölçtüğü bir şey kalmazdı.
- Ayar varsayılan olarak kapalıdır. Hesabın eşzamanlı bağlantı sınırı düşükse
  açılmamalıdır; arayüzde bu uyarı ve hesabın sınırı gösteriliyor.
- Çözücü ve codec bu turda kesin olarak elendi (bkz. 0.1.7 ve 0.1.8).

## Tek bağlantılı hesap · 0.2.0

- Kullanıcının üçüncü paneli sebebi değiştirdi: en yüksek hız 38,2 Mbps, içerik
  bit hızı 12,2–15,2 Mbps (53177 KB görüntü + 561 KB ses, 867 kare). Pay 2,5–3,1
  kat, yani bant genişliği artık yeterli. Buna karşılık **8/39 istek (%21)**
  başarısızdı. Kullanıcının hesabı aynı anda tek yayına izin veriyor.
- Sebep: iki medya isteği bir an bile üst üste bindiğinde sağlayıcı ikincisini
  geri çeviriyor ve oynatıcı bunu ölü kanal sayıyor. Sarma, tampon dolduktan
  sonra yeniden başlama gibi durumlar bu binişmeyi üretiyor.
- İki katmanlı düzeltme: hesap tek yayına izin veriyorsa (Xtream `max_connections`)
  istekler sıraya giriyor, yenisi öncekinin gerçekten kapanmasını bekliyor
  (canlı yayın bağlantısını sonsuza dek tuttuğu için bekleme 8 saniyeyle sınırlı).
  Buna ek olarak 403/429/5xx yanıtları ve bağlantı hataları oynatıcıya
  geçirilmeden önce artan gecikmeyle üç kez yeniden deneniyor.
- Paralel indirme, tek yayın hakkı olan hesapta kendiliğinden devre dışı kalıyor.
- Regresyon testi (`npm run test:solo`): ikinci eşzamanlı isteği 403 ile reddeden
  fixture, sarmalarla binişme üretiliyor. Düzeltmesiz koşuda sunucu 2 kez
  reddetti ve **iki red de oynatıcıya hata olarak geçti**. Düzeltmeyle 12 istekte
  sunucu hiç reddetmedi ve oynatıcıya tek hata geçmedi.
- Panele "Kurtarılan istek" sayacı eklendi; reddedilip yeniden denenen istekleri
  gösteriyor.
- Bant genişliği, vekil hızı, donanım çözücü ve codec bu noktada elenmiş durumda
  (bkz. 0.1.5–0.1.9).

## Derin tampon ve doğru ölçüm · 0.2.1

- Sıraya sokma çalıştı: kullanıcının sonraki panelinde sunucu hatası 0/5'e düştü.
  Ama kesinti sürdü ve panel çelişkili görünüyordu: ön tampon 26,2 sn dolu, ama
  en yüksek hız yalnızca 8,8 Mbps — 12+ Mbps'lik içerikle bu tampon o hızda asla
  dolamazdı. Ölçüm yöntemi hatalıydı: birden çok istek arasındaki boşta kalma
  süresini hıza karıştırıyordu.
- Ölçüm, her aktarımın kendi başlangıcından şu ana kadarki süresini kullanacak
  şekilde yeniden yazıldı; hiçbir zaman iki isteğin arasına sızmıyor. Devam eden
  büyük aktarımlar da örnekleniyor, yalnızca tamamlananlar değil — yoksa bir film
  daha bitmeden "Ölçülüyor" yazardı. 256 KB altı aktarımlar (manifest, kısa
  parça) ölçümü etkilemiyor. Doğruluk kalıcı testle korunuyor (`npm run
  test:rate`): tamponu dolup boşta kalan bir aktarımda ölçüm, gerçek sağlayıcı
  tavanının %50–150'si aralığında kalmalı; düzeltmeden önceki hatalı yöntem
  aynı senaryoda gerçek hızın **44 katı** yüksek okuyordu.
- Asıl kesinti sebebi: dalgalı sağlayıcı. Fixture'a gerçekçi dalgalanma eklendi
  (4 saniyede bir hızı 0,35× ve 1,6× arasında değiştiriyor). Sığ tamponla oynatıcı
  her düşüşte kesiliyor. Ayarlar → Tampon → Büyük, kesintiden sonra 10 saniyelik
  gerçek görüntü birikene kadar oynatmayı erteliyor; bu, sık kesinti yerine tek
  seferlik bir bekleme demek.
- Kritik bulgu: Chromium, duraklatılmış bir video öğesinde ileri okumayı kendi
  iç sınırıyla durduruyor (ölçülen tavan ~15-16 sn). İlk uygulamada hedef bu
  sınırın üzerindeydi ve tampon asla dolmadığı için **oynatıcı kalıcı olarak
  askıda kalıyordu**. Bu, yayına çıkmadan `npm run test:cushion` ile yakalandı.
  Hedef güvenli aralığa (10 sn) çekildi ve iki bağımsız güvenlik freni eklendi:
  tampon büyümesi duruyorsa veya bekleme 15 saniyeyi geçiyorsa oynatma kesinlikle
  devam ediyor. Sürdürülemez bir sağlayıcıda bile kilitlenmediği ayrı bir testle
  doğrulandı (`npm run test:cushion:safety`).
- Bant genişliği, vekil hızı, donanım çözücü, codec ve bağlantı reddi bu noktada
  elenmiş durumda (bkz. 0.1.5–0.2.0).

## Oynatma ayarları kaldırıldı, sabit varsayılanlar (sürüm numarası artırılmadı)

- Ayarlar sayfasındaki dört seçim (canlı yayın biçimi, sunucuya bildirilen
  oynatıcı, tampon, paralel indirme) kaldırıldı. Kendi denemelerimizde birbirinden
  belirgin fark vermiyorlardı ve sıradan kullanıcı için kafa karıştırıcıydı.
  Eski kayıtlardaki `liveFormat/agent/buffer/lanes` alanları `normalizeLibrary`
  tarafından atılıyor (birim testi).
- Seçilen varsayılanlar ve gerekçe:
  - **Canlı yayın: HLS, hls.js ile.** Yerel HLS çözümleyicisi kayan pencereli
    canlı listede açılışta `DEMUXER_ERROR_COULD_NOT_PARSE` vermişti (0.1.4) ve MP2
    sesli yayında gerçek zamana yetişemedi (0.1.7: 12 sn'de 5,1 sn; hls.js 11,9 sn).
    hls.js bu iki durumda da çalışıyor, kendi hata toparlama yoluna ve ayarlı
    tampona sahip. 4K kaybı yok: 3840×2160 / 16 Mbps, 3 sn'de 3,0 sn, 0/125 kare
    atlandı (`npm run test:4k`).
  - **Tampon: büyük.** Sağlayıcı dalgalanması asıl kesinti sebebiydi (0.2.1).
    Bedeli canlı yayında birkaç saniye gecikmedir; filmde ise kesintiden sonra en
    çok 15 sn'lik tek bir bekleme, güvenlik frenleriyle.
  - **Bildirilen oynatıcı: VLC.** IPTV panellerinin en yaygın tanıdığı istemci.
    Bu seçimin gerçek bir sağlayıcıda fark yarattığı buradan kanıtlanamaz; yalnızca
    her isteğin `VLC/` başlığıyla gittiği doğrulandı.
  - **Paralel indirme: hesaptan türetilir.** `lanesFor(max_connections)` = sınırın
    bir eksiği, en çok 4; bilinmeyen sınırda 1. Bir yuva oynatıcının kendi yan
    istekleri (mp4 dizini, sarma) için boş kalır; yoksa 2–3 yuvalı hesapta sağlayıcı
    fazla isteği reddeder ve paralel dilim bunu hata sayar (yeniden denemesi yok).
- Testler: `test:e2e` artık ayar sayfasında dört seçimin **bulunmadığını**, canlı
  yayının `blob:` (hls.js) ile oynadığını ve fixture'ın her istekte `VLC/` gördüğünü
  doğruluyor. `test:lanes` seçimi arayüzden değil hesabın bildirdiği sınırdan sürüyor:
  2 yuvalı hesap 25,9/40 sn oynadı, 1 kesinti; 5 yuvalı hesap 38,1/40 sn, 0 kesinti.
  `test:cushion` artık yalnızca varsayılanı ölçüyor (1 kesinti, 58,6 sn).
- Dürüst not: değişiklikten önce, eski `test:cushion` (normal ve büyük tamponu
  karşılaştıran sürüm) bu makinede başarısız oldu: normal tampon koşusunda film 70
  sn içinde 0,0 sn oynadı, büyük tamponda 57,7 sn oynadı ve 1 kesinti oldu. Nedeni
  araştırılmadı; "normal" yol artık üretilmediği için eski karşılaştırma yeniden
  çalıştırılamıyor.
- Geçenler: tip denetimi, 8 birim testi, `test:e2e`, `test:4k`, `test:lanes`,
  `test:cushion`, `test:cushion:safety`, `test:recover`, `test:switch`, `test:solo`,
  `test:rate`, `test:keychain`, `test:integration`. Paketli `.app` testleri
  (`test:packaged`, `test:4k:packaged`) yeniden koşulmadı.
- webOS deposuna dokunulmadı; `shared:check` eskiden olduğu gibi başarısız.

## Liste kilidi (sürüm numarası artırılmadı)

- Kategori başına PIN kilidi eklendi (canlı, film, dizi). PIN 4–8 rakam, yalnızca
  tuzlu PBKDF2-SHA256 (150 bin tur) özeti olarak kitaplık dosyasında saklanıyor.
  Tuz ve özet her `makePin` çağrısında değişiyor, özet PIN'i içermiyor (birim testi).
- Kilitli içerik liste, "Tüm içerikler", arama, favoriler ve son izlenenlerden
  çıkarılıyor. Kilitlemede çalan kanal duruyor. Bir PIN tüm kilitleri pencere
  boyunca açıyor; açık durumu yalnızca bellekte, yeniden başlatmada kilitli.
- Hatalı deneme sınırı: 5 yanlıştan sonra 30 saniye bekleme; bu sırada doğru PIN de
  reddediliyor. Sayaç pencere boyunca tutulur, pencereyi kapatıp açmak sıfırlamaz.
- `npm run test:lock` gerçek Electron penceresinde doğruluyor: kısa ve uyuşmayan PIN
  reddi, kilitli listede kanalın görünmemesi, "Tüm içerikler", favoriler ve son
  izlenenlerde gizlenmesi, Esc'in yalnızca pencereyi kapatması, yanlış PIN, doğru
  PIN, kilitlemede oynatmanın durması ve favorinin gizlenmesi, hatalı deneme
  sınırı, yeniden başlatmada kilidin kalması ve PIN ile tüm kilitleri kaldırma.
  Gizleme süzgeci kaldırıldığında test "Tüm içerikler" adımında başarısız oluyor.
- Bilinen sınırlar: (1) Süzgeç arayüzde uygulanır; kitaplık dosyasını okuyabilen biri
  PIN özetini görür. Bu çocuk ve ev içi gizlilik içindir. (2) Bu özellikten önce
  favorilere veya geçmişe girmiş bölümlerin kategorisi boş kayıtlıdır; kilitli bir
  dizinin eski bölüm kayıtları gizlenemez. Yenileri gizlenir. (3) Yalnızca Mac:
  TV tarafındaki `file://` sayfa `crypto.subtle` kullanamayabilir, webOS'a
  taşınmadan önce doğrulanmalı.

## Afişler ve kanal logoları (sürüm numarası artırılmadı)

- Kanal ve film/dizi listelerinde sağlayıcının verdiği logo veya afiş adın yanında
  gösteriliyor; görsel yoksa veya yüklenemezse baş harfler (kanal) ya da simge
  (film) kalıyor. Ayarlar → "Kanal ve film afişlerini göster" ile açılıp kapanıyor.
  **Varsayılan kapalı** (gizlilik): açılana kadar sağlayıcı dışında hiçbir siteye
  bağlanılmıyor.
- Görseller sayfaya değil ana sürece iniyor: `kiyi://image/<tür>/<id>`. Sağlayıcı
  adresi `Session` belleğinde kalıyor, arayüze giden satırdan siliniyor (birim testi:
  yanıtta `cdn.example` geçmiyor). Kitaplık dosyası hiçbir adres içermiyor; favori ve
  geçmiş afişleri `icons-<profil>.json` dosyasında, arayüzün görmediği yerde.
- `ImageGateway` birim testi: doğru PNG geçiyor; HTML, SVG, 4 MB'tan büyük ve 404
  yanıtlar 404'e dönüyor; bilinmeyen kimlik, başka tür ve `HEAD` ağa hiç çıkmıyor;
  önbellekteki ve bulunamayan resim ikinci kez sunucuya sorulmuyor; 12 eşzamanlı
  resimde en çok 4 istek uçuşta.
- `npm run test:posters` gerçek Electron penceresinde: logo yüklendi (64×96), eksik
  görselde "İS" baş harfleri kaldı, tüm `<img>` adresleri `kiyi://image/` ile
  başlıyor, sayfa içeriğinde sağlayıcı yolu yok, kanal afişli listede de oynuyor,
  kapatınca `img.poster-image` yok, açınca geri geliyor, favori filmin afişi katalog
  açılmadan yeniden başlatmada geliyor, kitaplık dosyasında adres yok.
- Ekran görüntüsü bir hata yakaladı: `.poster` konumlandırılmamışken afiş tüm kartı
  kaplıyor ve ad altında kayboluyordu. Düzeltildi ve testte geometri denetimi
  (resim çerçeveden taşmıyor, ad örtülmüyor) eklendi.
- Gizlilik: afiş adresi üçüncü taraf bir görsel sitesine işaret edebilir; açıkken o
  site IP adresini ve hangi listeyi açtığını görür. Bu yüzden varsayılan kapalı ve
  Ayarlar ile README bunu açıkça yazıyor. Kapalıyken ana süreç hiçbir adres sunmuyor
  ve diske yazmıyor (birim testi: kapalıyken `posterUrl` boş, adres dosyası
  oluşmuyor; kapatınca dosya `{}` oluyor). `test:posters` varsayılan durumda üç
  liste gezildikten sonra sunucunun hiç görsel isteği görmediğini doğruluyor;
  varsayılan açığa çevrilince test bu adımda başarısız oluyor.
- Gizlilik taraması: kaynakta `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket,
  `crashReporter`, `autoUpdater`, `console` veya dosyaya günlük yazımı yok; bağımlılıklar
  yalnızca hls.js, mpegts.js, react, react-dom. Sağlayıcı dışına giden tek yol afişlerdir.
- Bilinen sınırlar: bölümlerde afiş yok; bir kategori ilk açılana kadar o listenin
  afişleri istenmez (yalnızca görünen ilk 60 öğe istenir); Mac'e özgü, TV'de
  `Settings` bu seçeneği göstermiyor.

## Liste yönetimi ve kutucuk düzeni (sürüm numarası artırılmadı)

- Kanal, film ve diziler kutucuk ızgarasında gösteriliyor: resim kartı dolduruyor, ad
  alt kenarda, filmde puan köşede. Logo/afiş yine yalnızca Ayarlar'da açılınca gelir
  (varsayılan kapalı); kapalıyken kartlar baş harfler veya film/dizi simgesiyle çiziliyor.
  Kategori listesine "Kategori ara" eklendi. Kategori adının yanındaki kilit simgeleri
  kaldırıldı: kilitli liste de simgesiz, yalnızca içeriği gizli.
- Kilit ve gizleme Ayarlar → Listeleri yönet bölümüne taşındı. Her kategori `Görünür`,
  `Kilitli` veya `Gizli`. Gizli liste her yerde yok (liste, "Tüm içerikler", arama,
  favoriler, son izlenenler) ve PIN girilince de açılmıyor. Gizli ile kilitli aynı
  anda olamaz (birim testi). Varsayılan ilk kategori gizli olanları atlıyor.
- PIN kuralı: kilitlemek ve gizlemek serbest; kilitli veya gizli bir listeyi Görünür
  yapmak PIN varsa PIN istiyor. Kural kaldırılınca `test:lock` tam bu adımda başarısız
  oluyor.
- `test:lock` yeniden yazıldı: Ayarlar'dan kilitleme, kısa/uyuşmayan PIN reddi,
  kategori listesinde hiç kilit simgesi olmaması, gizleme (iki liste), göstermek için
  yanlış ve doğru PIN, yeniden kilitlemede oynatmanın durması, hatalı deneme sınırı,
  yeniden başlatmada kilidin ve gizlemenin kalması, tüm kilitleri kaldırınca PIN
  kalmadığı için gizli listenin serbestçe gösterilebilmesi.
- `test:posters` yeni kart yapısına uyarlandı; geometri denetimi resmin kartı aşmadığını
  ve adın resmin üstünde durduğunu doğruluyor.
- Bilinen sınırlar: kategori başına içerik sayısı gösterilmiyor (Xtream kategori
  yanıtında sayı yok; saymak tüm kataloğu indirmek demek olurdu). Eski favori/geçmiş
  bölümlerinin kategorisi boş kayıtlı olduğundan gizlenemez.

## Kendi sıralamanız (sürüm numarası artırılmadı)

- Listelerin sırası Ayarlar → Listeleri yönet'te (başa al, yukarı, aşağı), bir listedeki
  kanal/film/dizilerin sırası liste başlığındaki "Sırala" modunda, favoriler de aynı
  modda değiştirilebiliyor. Sıralama modunda kart oynatmıyor; arama yazılınca mod kapanıyor.
  İlk açılan liste, kullanıcı sırasındaki ilk gizli olmayan liste. "Sırayı sıfırla" hem
  liste başlığında hem Ayarlar'da var.
- Kayıt kısmi: yalnızca kullanıcının düzenlediği ön kısım saklanıyor, gerisi sağlayıcı
  sırasında arkadan ekleniyor. Bu sayede 50 bin kanallık bir listede "başa al" tek kimlik
  yazıyor.
- Birim testleri: `applyOrder` temel durumları (bilinmeyen kimlik, yeni gelen satır);
  600 rastgele taşımanın (başa al, yukarı, aşağı; 300. adımda sağlayıcının bir kanalı
  düşürmesiyle) düz bir dizideki taşımayla birebir aynı görünen sırayı vermesi; 5000
  kanallık listede `top`'un tek kimlik yazması; gizli öğeler arasındaki favori taşıması;
  geçersiz/tekrarlı kayıtların `normalizeLibrary` ile temizlenmesi.
- `npm run test:order` gerçek Electron penceresinde: kartlar sıralama modunda oynatmıyor, uçtaki
  düğmeler devre dışı, başa al / öne / geriye doğru sırayı veriyor, arama sırasında düğmeler
  yok, Ayarlar'da liste taşıma (uçlarda devre dışı, arama sırasında oklar yok) kategori
  panelini ve ilk açılan listeyi değiştiriyor, favoriler sıralanıyor, hepsi yeniden
  başlatmada kalıyor ve sıfırlama sağlayıcı sırasını geri getiriyor. Kategori panelinin sırayı
  yok sayması bozulunca test başarısız oluyor. Test yazılırken iki hata yakalandı: kartın ortasına
  basmak sıralama düğmesine denk geliyordu (test düzeltildi) ve arama sırasında gizlenen
  sıralama modu arama silinince sessizce geri geliyordu (artık arama yazılınca mod kapanıyor).
- Bilinen sınırlar: "Tüm içerikler" ve "Son izlenenler" sıralanamıyor (ilki çok büyük, ikincisi
  zamana göre); sürükle-bırak yok, düğmeler var; kayıt ön kısımla sınırlı (liste başına en çok
  1000, kategori başına tür için en çok 2000 kimlik).

## Ses ve altyazı (sürüm numarası artırılmadı)

- Film ve dizi bölümlerinde oynatıcıya **Ses ve altyazı** menüsü eklendi: dosyadaki
  dublaj parçalarının listesi ve seçimi, ayrıca kullanıcının kendi `.srt`/`.vtt`
  altyazı dosyasını yüklemesi. Canlı yayında düğme yok. Ayarlar sayfasına seçenek
  eklenmedi; son seçilen ses dili kendiliğinden hatırlanıyor (yukarıdaki "varsayılan
  hesaptan veya veriden türetilsin" ilkesine uygun).
- Tasarım yazılmadan önce Chromium'un ne verdiği gerçek Electron penceresinde ölçüldü
  (ffmpeg ile üretilmiş, İngilizce ve Türkçe işaretli iki sesli `.mp4` ve `.mkv`):
  - `video.audioTracks` **varsayılan olarak yok**; `enableBlinkFeatures:
    'AudioVideoTracks'` ile geliyor ve iki kapta da dil kodlarıyla (`eng`, `tur`) listeleniyor.
  - Dosyaya gömülü altyazı (`mov_text` ve `srt`) iki kapta da `video.textTracks`'e
    **hiç düşmüyor**. Bu yüzden gömülü altyazı gösterilemiyor; yalnızca kullanıcının
    yüklediği dosya gösteriliyor. Sunucu tarafında ayıklamak (ffmpeg paketlemek) ve
    mkv'de altyazı bloklarının dosyanın her yerine dağılmış olması yüzünden tüm dosyayı
    indirmek gerektiği için denenmedi.
  - **Parça geçişi gerçekten sesi değiştiriyor.** Birinci parça 440 Hz, ikincisi 880 Hz
    sinüs; Web Audio çözümleyicisinde tepe 439 Hz → geçişten sonra 879 Hz → geri
    dönünce 439 Hz okundu, `.mp4` ve `.mkv` için aynı. Bu ölçüm uygulamanın dışında, yerel
    ve aynı kökenli bir sayfada yapıldı; uygulamanın içindeki e2e testi hangi parçanın
    çaldığını frekansla **doğrulamaz**, yalnızca `enabled` bayraklarının döndüğüne,
    çözülen ses baytının artmaya devam ettiğine ve görüntünün ilerlediğine bakar.
  - **AC-3 ikinci sesi Chromium listeden çıkarıyor:** birinci parça AAC, ikincisi AC-3
    olan `.mp4` ve `.mkv`'de `audioTracks` yalnızca AAC parçasını veriyor. Sonuç:
    sessiz bir parça seçilemiyor (0.1.7'deki AC-3 sessizliğine düşülmüyor), ama o
    dublaj da hiç görünmüyor. Menüde bu açıkça yazıyor. Gerçek sağlayıcının
    dublajlarının hangi codec'te olduğu buradan bilinemez.
- Altyazı dosyası: UTF-8, UTF-16 (BOM'lu), Türkçe windows-1254 ve Farsça windows-1256
  okunuyor (son ikisi `iconv` ile üretilmiş gerçek bayt dizileriyle birim testinde);
  kod sayfası yüksek bayt oranından tahmin ediliyor (%15 üstü Farsça). SRT ve
  WebVTT: BOM, CRLF, `{\an8}` biçem etiketleri, WebVTT başlığı/`NOTE` blokları ve hücre
  ayarları, saatsiz zaman damgaları, ters/boş zaman aralıkları ayrıştırmada elenir.
  Üst sınırlar: 2 MB dosya, 20.000 altyazı satırı. Dosya içeriği `VTTCue` olarak
  eklenir (HTML değil), sayfada betik çalıştırmaz.
- Altyazı konumu: pencerede kontrol çubuğu her zaman göründüğü için yazı görüntünün
  alttan ~%26'sında, tam ekranda ~%10'unda duruyor (`snapToLines = false`, `lineAlign =
  'end'`). Önceki denemede varsayılan konum kontrol çubuğuyla çakışıyordu; ekran
  görüntüsüyle yakalandı ve düzeltildi. Farsça satır sağdan sola doğru çiziliyor.
- Kaydedilen tek şey `preferences.audio` (iki-üç harfli dil anahtarı, `tr`/`fa`/...).
  Parça numarası ve altyazı dosyası saklanmıyor (test: kitaplıkta dosya adı yok);
  `normalizeLibrary` biçime uymayan değeri atıyor (birim testi).
- Birim testleri (`tests/core.test.ts`): dil anahtarı (`tur`/`per`/`tr-TR`...), parça adları
  ve aynı dilde numaralandırma, `preferredTrack`, altyazı kod çözme ve ayrıştırma,
  kitaplık normalizasyonu. `npm run test:tracks` gerçek Electron penceresinde: iki
  dublaj listeleniyor ve ilki seçili; Türkçeye geçince çözülen ses baytı artıyor,
  görüntü ilerliyor, hata çıkmıyor; menü oynatıcının içinde kalıyor; Türkçe, Farsça ve
  windows-1254 altyazı doğru metinle ve doğru anda çıkıyor; Kapalı/açık; yeni dosya eskisinin
  yerine geçiyor; altyazı içermeyen dosya reddediliyor ve eskisini bozmuyor; Esc önce
  menüyü, sonra oynatıcıyı kapatıyor; yeni pencerede film ve dizi bölümü Türkçe sesle
  kendiliğinden başlıyor ve İngilizceye dönülünce sonraki bölüm onu izliyor; canlı
  yayında düğme yok. `AudioVideoTracks` kapatılınca test tam bu adımda başarısız oluyor
  (İngilizce/Türkçe seçenekleri listede yok).
- Test yazılırken yakalananlar: menü küçük oynatıcıda tek sütunken "Altyazı dosyası
  yükle" düğmesi kaydırma alanının altında kalıyordu (iki sütuna çevrildi); testin kendisi
  menüyü açıkken tekrar açmaya çalışıp kapatıyordu (test düzeltildi).
- Bilinen sınırlar: (1) AC-3, E-AC-3 ve DTS dublajlar listelenmez. (2) Gömülü altyazı
  gösterilemez; sağlayıcı altyazıyı ayrı bir adres olarak verse bile Xtream API'sinde
  bunun için standart bir alan olmadığından bu sürümde okunmuyor; gerçek bir
  sağlayıcıdan `get_vod_info`/`get_series_info` yanıtı görülürse eklenebilir. (3)
  Altyazı zamanlama kaydırması (gecikme/öne alma) yok; farklı sürüme ait bir dosya
  kaymış görünürse düzeltilemez. (4) Yüklenen altyazı sonraki bölüme taşınmaz. (5) HLS
  biçimli film (`.m3u8`) için `audioTracks`'in dolup dolmadığı denenmedi. (6) Ses
  geçişinin gerçek bir sağlayıcıda, özellikle tek bağlantılı hesapta nasıl davrandığı
  denenmedi; yalnızca yerel fixture ile doğrulandı. (7) webOS deposuna
  dokunulmadı; paylaşılan klasörlerde (`src/core`, `src/ui`) Mac ileride, `shared:check`
  eskiden olduğu gibi başarısız. TV'de Chromium 53 `audioTracks` ve `VTTCue` sunmayabilir.

- Geçenler (değişiklikten sonra): tip denetimi, 25 birim testi, derleme, `test:tracks`,
  `test:e2e`, `test:lock`, `test:posters`, `test:order`, `test:switch`, `test:solo`,
  `test:integration`, `test:4k` (0/126 kare atlandı), `test:cushion`, `test:lanes`,
  `test:recover`. `test:rate`, `test:keychain`, `test:cushion:safety` ve paketli `.app`
  testleri yeniden koşulmadı; `release/` altındaki `.app` bu özellik olmadan eski sürümde
  duruyor, `npm run package` ile yeniden üretilmeli.

## Dış doğrulama gerektiren sınır

Fiziksel LG TV veya çalışan LG simülatörü verilmedi. Dolayısıyla `.ipk` kurulum,
TV üzerindeki Luna izinleri, farklı cihaz codec'leri ve gerçek Magic Remote
imlecinin davranışı bu çalışma alanından doğrudan doğrulanamadı. Gerçek Xtream
hesabı da verilmedi; sağlayıcıya özgü oynatma biçimleri ancak uygulama girişinden
ve yetkili hesapla denenebilir. Kodda gerçek hesap verisi kullanılmadı.

Test videoları ffmpeg ile yerelde üretilen testsrc2 + sinüs dalgasıdır.
Testler gerçek hesap, harici IPTV adresi veya üçüncü taraf içerik kullanmaz.
