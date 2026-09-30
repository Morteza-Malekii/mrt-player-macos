# MRT-Player (macOS) — Frontend Depo Rehberi

Backend geliştiricisi olup frontend'e yeni başlayanlar için. Bu belge repoyu
**nasıl yazıldığını, nasıl çalıştığını ve nasıl geliştirileceğini** anlatır.

- Kod durumu: sürüm **0.2.1**, 2026-09-30 tarihli çalışma dizini.
- Belgedeki her iddia koddan okunarak yazıldı. Doğrulanamayan yerler açıkça
  "doğrulanmadı" diye işaretlendi.
- Satır numarası yerine dosya ve fonksiyon adı verildi; satırlar kayar, adlar
  daha uzun yaşar.

## İçindekiler

1. [Proje bir bakışta](#1-proje-bir-bakışta)
2. [Teknoloji yığını](#2-teknoloji-yığını)
3. [Frontend kavramları: hızlı kurs](#3-frontend-kavramları-hızlı-kurs)
4. [Mimari](#4-mimari)
5. [Klasör ve dosya haritası](#5-klasör-ve-dosya-haritası)
6. [Uçtan uca akışlar](#6-uçtan-uca-akışlar)
7. [Arayüz durum yönetimi](#7-arayüz-durum-yönetimi-workspace)
8. [Oynatma altyapısı](#8-oynatma-altyapısı-en-zor-kısım)
9. [Güvenlik modeli](#9-güvenlik-modeli)
10. [Veri saklama](#10-veri-saklama)
11. [Build, çalıştırma, paketleme](#11-build-çalıştırma-paketleme)
12. [Test stratejisi](#12-test-stratejisi)
13. [Geliştirme akışı ve tarifler](#13-geliştirme-akışı-ve-tarifler)
14. [Kod stili ve konvansiyonlar](#14-kod-stili-ve-konvansiyonlar)
15. [Bilinen pürüzler](#15-bilinen-pürüzler-ve-dikkat-edilecekler)
16. [Öğrenme planı](#16-öğrenme-planı)
17. [Sözlük](#17-sözlük)

---

## 1. Proje bir bakışta

**MRT-Player**, kullanıcının kendi **Xtream** IPTV hesabıyla çalışan bir macOS
video oynatıcısıdır. Uygulama içerik, kanal veya abonelik sağlamaz; kullanıcı
sunucu adresi, kullanıcı adı ve şifresini girer, uygulama canlı TV, film ve
dizileri listeler ve oynatır.

**Xtream nedir?** Bir IPTV sağlayıcısının sunduğu HTTP arayüzüdür:

```
GET {sunucu}/player_api.php?username=U&password=P                          → hesap bilgisi (JSON)
GET {sunucu}/player_api.php?username=U&password=P&action=get_live_categories
GET {sunucu}/player_api.php?...&action=get_live_streams&category_id=12
GET {sunucu}/live/U/P/12345.m3u8        → canlı yayın (HLS)
GET {sunucu}/movie/U/P/777.mp4          → film dosyası
```

Kimlik bilgisi URL içinde gider. Bu yüzden repo boyunca "URL'yi arayüze
sızdırma" kuralı vardır (bkz. bölüm 9).

**Uygulama türü:** Electron. Yani içinde Chromium (tarayıcı motoru) ve Node.js
bulunan bir masaüstü kabuğu. Arayüz React ile yazılmış bir web sayfasıdır;
arka planda Node.js kodu çalışır.

**Boyut:** `src/` altında yaklaşık 1.100 satır TypeScript vardır. Ama satırlar
çok uzun ve yoğundur (bkz. bölüm 14). Ayrıca 17 KB'lık tek bir CSS dosyası
vardır.

**Kardeş depo:** `/Users/a1/Projects/IpTv/webOs` aynı uygulamanın LG TV
sürümüdür. `src/core`, `src/runtime`, `src/ui` klasörleri iki depoda kopya
olarak tutulur (bkz. bölüm 13.7).

### Sen neyi biliyorsun, neyi öğreneceksin?

| Backend'de bildiğin | Bu repoda karşılığı |
| --- | --- |
| Controller / router | `Session.dispatch` içindeki `switch (action)` |
| DTO / request-response şeması | [models.ts](../src/core/models.ts) içindeki tipler, `Reply<T>` zarfı |
| Servis katmanı | `Xtream` sınıfı ([xtream.ts](../src/core/xtream.ts)) |
| HTTP istemcisi | `request()` ve `NodeTransport` ([http.ts](../src/runtime/http.ts)) |
| Repository | `FileLibraryStore` (profil başına bir JSON dosyası) |
| Secret manager | `Vault` arayüzü, macOS'ta `MacVault` (Anahtar Zinciri) |
| Reverse proxy | `MediaGateway` ([media.ts](../src/platform/mac/media.ts)) |
| Dependency injection | `main.ts` içinde `new Session(vault, store, ...)` |
| Middleware / yetki kontrolü | `ipcMain.handle` içindeki gönderen doğrulaması, `LOCKED` kontrolü |
| Girdi doğrulama | `object()`, `text()`, `id()`, `normalize*()` |
| Mock sunucuyla entegrasyon testi | [fixture.ts](../scripts/fixture.ts) |
| CI kapısı | `npm run check` |

**Bu tablonun sol tarafı sana tanıdık gelecek.** Repoda rahat edeceğin yarısı
`src/core`, `src/runtime`, `src/platform/mac/{main,media}.ts`. Öğrenmen gereken
yarısı `src/ui/*`, `adapter.ts` ve `style.css`.

---

## 2. Teknoloji yığını

Sürümler [package.json](../package.json) içinde sabitlenmiştir.

| Araç | Ne işe yarar | Backend'deki karşılığı | Repoda nerede |
| --- | --- | --- | --- |
| **TypeScript** 5.9 (`strict`) | Tipli JavaScript | Tipli dil (Go/PHP tip bildirimleri gibi) | Tüm `src`, `tests`, `scripts/*.ts` |
| **React** 18.3 | Arayüzü fonksiyonlardan kurar | Şablon motoru + durum yönetimi | `src/ui/*`, [main.tsx](../src/main.tsx) |
| **Electron** 44 | Chromium + Node.js'i tek uygulamada paketler | Frontend + backend'i tek ikilide çalıştıran çatı | `src/platform/mac/*` |
| **esbuild** 0.28 | Kodu derler ve tek dosyaya birleştirir (bundle) | Derleyici / linker | [build.mjs](../scripts/build.mjs) |
| **tsx** | TypeScript dosyalarını doğrudan Node'da çalıştırır | `go run` benzeri | `npm test`, `scripts/*.ts` |
| **node:test** | Node'un yerleşik test çalıştırıcısı | PHPUnit / `go test` | [core.test.ts](../tests/core.test.ts) |
| **Playwright** | Gerçek Electron penceresini otomatik kullanır | Uçtan uca test istemcisi | `scripts/e2e*.ts` |
| **hls.js** 1.7 | HLS akışını tarayıcıda oynatır (MSE ile) | Kütüphane | [adapter.ts](../src/platform/mac/adapter.ts) |
| **mpegts.js** 1.8 | MPEG-TS akışını tarayıcıda oynatır | Kütüphane | [adapter.ts](../src/platform/mac/adapter.ts) |
| **ffmpeg-static** | Testler için sentetik video üretir | Test verisi üreticisi | [fixture.ts](../scripts/fixture.ts) |
| **@electron/packager** | `.app` paketi üretir | Release aracı | [package.mjs](../scripts/package.mjs) |

**Repoda olmayanlar (bilerek):**

- Router yok. Ekran değişimi bir `useState` ile yapılır.
- Redux/Zustand gibi global durum kütüphanesi yok.
- UI kiti, Tailwind veya CSS framework'ü yok. Tek `style.css` var.
- ESLint ve Prettier yok. Tek statik denetim `tsc`.
- Vite/Webpack yok, hot reload yok. Her değişiklikte uygulamayı yeniden
  başlatırsın.
- `React.StrictMode` kullanılmıyor. Effect'ler geliştirmede ikinci kez
  çalıştırılmaz.

Yapılandırma dosyaları:

- [tsconfig.json](../tsconfig.json): `strict: true`, `jsx: "react-jsx"` (dosyaya
  `import React` yazmana gerek yok), `noEmit: true` (tsc yalnızca denetler,
  çıktı üretmez).
- [package.json](../package.json): `"type": "module"`, yani `.js/.ts/.mjs`
  dosyaları ES module sayılır. Derlenen Electron dosyaları bilerek `.cjs`
  uzantılıdır.

---

## 3. Frontend kavramları: hızlı kurs

Bu bölüm, repoyu okumak için gereken asgari frontend bilgisidir.

### 3.1 Tarayıcı modeli

- **HTML → DOM:** Sayfa bir ağaçtır (DOM). Her etiket bir düğümdür (`<button>`,
  `<video>`, `<input>`). JavaScript bu ağacı okuyup değiştirir.
- **CSS:** Düğümlere `class` verirsin, stil dosyasında `.sidebar { ... }` diye
  biçimlendirirsin.
- **Tek iş parçacığı + olay döngüsü:** Tarayıcıdaki JavaScript tek thread'de
  çalışır. Uzun iş ekranı dondurur. Bekleme gerektiren her şey `async`/`Promise`
  ile yapılır. Go'daki goroutine gibi düşünme; Node.js'in olay döngüsü gibi
  düşün.
- **Olaylar:** `click`, `keydown`, `timeupdate`... Bir fonksiyonu olaya bağlarsın.
  Repoda hem React'in `onClick={...}` biçimi hem doğrudan
  `addEventListener('keydown', ...)` kullanılır.
- **`<video>` elementi:** Tarayıcının hazır video oynatıcısı. `video.src = url;
  video.play()` ile çalışır. `currentTime`, `buffered`, `paused` gibi alanları
  ve `playing`, `waiting`, `error` gibi olayları vardır. Bu projenin kalbi
  bu element etrafında döner (bölüm 8).

### 3.2 TypeScript'i 10 dakikada

```ts
type Kind = 'live' | 'vod' | 'series';        // birleşim tipi: yalnızca bu üç değer
interface Item { id: string; kind: Kind; name: string; rating?: string }   // ? = isteğe bağlı
call<Category[]>('categories', { kind })      // <...> = generic: dönüş tipini belirtir
Record<Agent, string>                         // Agent'ın her değeri için bir string
Partial<Preferences>                          // tüm alanları isteğe bağlı yapar
value as Library                              // "bana güven" tip dönüşümü (denetimsiz)
video.current!                                // "null değil" iddiası (denetimsiz)
import type { Item } from './models'          // yalnızca tip; derlemede silinir
function f(x: unknown)                        // "bilinmiyor": kullanmadan önce daralt
```

Repodan iki önemli fikir:

- **Yapısal tipleme.** `Transport` arayüzü tek metotlu bir sözleşmedir
  (`json(url)`). Gerçek kodda `NodeTransport` uygular, testte ise düz bir
  fonksiyon nesnesi verilir: `{ json: async () => ({ user_info: { auth: 0 } }) }`.
  Sınıf `implements` yazmak zorunda değildir; şekil uyuyorsa yeter.
- **Tipler çalışma zamanında yoktur.** Sunucudan gelen JSON'un TypeScript tipiyle
  uyuştuğunu tip sistemi garanti etmez. Bu yüzden repo, dış veriyi
  `object()`, `text()`, `id()` yardımcılarıyla elle temizler
  ([errors.ts](../src/core/errors.ts)). Backend'de "girdiyi doğrula, hiçbir
  şeye güvenme" dediğin şeyin aynısı.

### 3.3 React'i 15 dakikada

**Bileşen = props alan, JSX döndüren fonksiyon.**

```tsx
function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return <div className="modal-backdrop">...{children}</div>;
}
```

JSX, HTML'e benzeyen sözdizimidir. `{ }` içine JavaScript yazarsın. `class`
yerine `className` yazılır.

**State (durum).** Ekranda değişen her şey.

```tsx
const [query, setQuery] = useState('');     // [değer, değeri değiştiren fonksiyon]
<input value={query} onChange={e => setQuery(e.target.value)} />
```

`setQuery` çağrılınca React bileşen fonksiyonunu **yeniden çalıştırır**, yeni
JSX'i eskisiyle karşılaştırır ve DOM'da yalnızca farkı günceller. Buna
*render* denir. Kural: state'i **doğrudan değiştirme**, her seferinde yeni
değer ver:

```tsx
update(current => ({ ...current, recent: [] }))   // "..." ile kopyala, bir alanı değiştir
```

**Effect (yan etki).** Render sonrası çalışan kod: ağ isteği, zamanlayıcı,
olay dinleyici.

```tsx
useEffect(() => {
  const t = setInterval(fn, 15000);        // kur
  return () => clearInterval(t);           // temizle (bileşen kalkarken / bağımlılık değişirken)
}, [dep1, dep2]);                          // yalnızca bunlar değişirse yeniden çalış; [] = bir kez
```

Lifecycle kancalarının (mount/unmount/update) tek fonksiyonda birleşmiş hali.
Bağımlılık dizisi yanlış olursa "eski veriyle çalışan" hatalar çıkar.

**Ref.** `useRef` yeniden render **tetiklemeyen** değişken kutusudur. İki işe
yarar: (1) DOM elementine erişim (`video.current`), (2) render'lar arası
taşınan ama ekranı ilgilendirmeyen değer (`libraryRef`, zamanlayıcı kimliği).

**useMemo.** Türetilmiş değeri (filtrelenmiş liste gibi) yalnızca girdisi
değişince yeniden hesaplar.

**key.** Listeleri çizerken her öğeye kararlı bir kimlik verirsin:
`<article key={itemKey(item)}>`. React hangi öğenin hangisi olduğunu bununla
anlar.

**Kontrollü input.** `value` ve `onChange` React'te durur; input'un gerçeği
state'tir.

**Eski kapanım (stale closure).** Bir fonksiyon, oluşturulduğu render'daki
değerleri "yakalar". `setTimeout` veya `addEventListener` içine verilen
fonksiyon sonraki render'da güncellenmiş state'i **görmez**. Repo bunu ref ile
çözer (bkz. 3.4).

### 3.4 Bu repoda sürekli göreceğin 5 kalıp

Bunları tanırsan `App.tsx` ve `Player.tsx` okunur hale gelir.

**1. İptal bayrağı (yarış durumu koruması).** Bileşen kalkarsa veya girdi
değişirse eski isteğin cevabı ekrana yazılmasın.

```tsx
useEffect(() => {
  let current = true;
  platform.call('items', { kind: view, category }).then(v => { if (current) setItems(v); });
  return () => { current = false; };      // yeni effect başlarken eskisi "iptal" olur
}, [view, category, reload]);
```

Backend'deki `context.Context` iptaline veya "idempotency/ETag ile eski cevabı
at" fikrine benzer.

**2. Ref ile "en güncel değer".** Zamanlayıcıda güncel veriye erişmek için:

```tsx
const libraryRef = useRef(library);       // App.tsx: update() hem ref'i hem state'i yazar
callback.current = onProgress;            // Player.tsx: her render'da en yeni prop'u saklar
```

**3. Revizyon sayacı.** Zaman içinde çakışan asenkron işleri numaralandırırsın;
yalnızca en yeni olan sonucu uygular.

```tsx
const version = ++playRevision.current;                 // App.play()
... await platform.call('play', ...) ...
if (version === playRevision.current) setPlaying(...);  // araya başka kanal girdiyse at
```

Aynı fikir sunucu tarafında da var: `Session.revision`.

**4. Debounce + seri kayıt kuyruğu.** Favori/ayar değişince 400 ms bekle, sonra
kaydet; kayıtlar birbirini ezmesin diye bir Promise zincirine diz
(`saveQueue`). Bkz. bölüm 6.5.

**5. "Kur ve temizleme fonksiyonu döndür."** `platform.attach(video, playback,
onError)` oynatıcıyı kurar ve **bir dispose fonksiyonu döndürür**. Çağıran
(Player'daki effect) bunu cleanup olarak kullanır.

### 3.5 CSS'in bu repodaki hali

- Tek dosya: [style.css](../src/ui/style.css). `main.tsx` içinde `import
  './ui/style.css'` yazılır, esbuild bunu `dist/app/app.css` olarak üretir.
- Koyu tema sabit (`color-scheme: dark`). **CSS değişkeni yok**; renkler
  (`#0c111b`, `#6ce2bd`, `#81e5c4`...) her yerde elle yazılmış. Tema
  değiştirmek toplu bul-değiştir demektir.
- Sınıf adları düz, kebab-case ve bileşene göre öbeklenmiş: `.sidebar`,
  `.nav-item`, `.content-card`, `.player-controls`, `.playback-stats`.
  BEM veya CSS-in-JS yok.
- Yerleşim `flex` ve `grid` ile. Tek responsive kırılım
  `@media (max-width:1200px)`; ayrıca `prefers-reduced-motion` desteği var.
- `:focus-visible` ile 3 px açık yeşil odak halkası: klavye ve TV kumandası
  için kritik.
- Afiş görselleri yok. Sebep: CSP `img-src 'self' data:` diyor, yani uygulama
  dışarıdan resim yükleyemez. Filmler `poster tone-N` renkli karolarla
  çizilir. `Item.icon` tipte var ama `Xtream.items` onu hiç doldurmaz.

### 3.6 Erişilebilirlik = test seçicisi

Arayüzde her yerde `aria-label`, `role="alert"`, `role="status"`,
`aria-pressed` görürsün. Bunlar hem ekran okuyucu içindir hem de
**Playwright testlerinin element bulma yoludur**:

```ts
page.getByRole('button', { name: 'Tam ekran', exact: true })
```

Sonuç: Türkçe arayüz metinlerini veya `aria-label`'ları değiştirirsen e2e
testleri kırılır. Metin değiştirdiğinde `scripts/e2e*.ts` ve
[ui-checks.ts](../scripts/ui-checks.ts) dosyalarını da güncelle.

---

## 4. Mimari

### 4.1 Büyük resim

Bir Electron uygulaması **iki ayrı süreçten** oluşur. Bu, backend mantığına en
yakın yapıdır: renderer istemcidir, main süreci onun arkasındaki sunucudur.

```
┌─────────────────────────── MRT-Player.app (tek uygulama) ───────────────────────────┐
│                                                                                     │
│  RENDERER SÜRECİ (Chromium, sandbox, ağ erişimi YOK)                                │
│  ┌───────────────────────────────────────┐                                          │
│  │ src/main.tsx → <App platform={...} /> │                                          │
│  │ src/ui/*  (React ekranları)           │                                          │
│  │        │  platform.call('items', ..)  │                                          │
│  │        ▼                              │                                          │
│  │ src/platform/mac/adapter.ts           │                                          │
│  │        │  window.kiyi.call(..)        │                                          │
│  │ ───────▼─────── preload.ts (köprü) ───│───┐                                      │
│  │ <video src="kiyi://media/<jeton>">    │   │ IPC: 'kiyi:call'                     │
│  └────────────────┬──────────────────────┘   │                                      │
│                   │ kiyi://media/...         ▼                                      │
│  MAIN SÜRECİ (Node.js, tam yetki)                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────┐       │
│  │ src/platform/mac/main.ts   pencere · menü · kiyi:// protokolü · IPC       │       │
│  │   ├─ Session.call()  (src/runtime/session.ts)  ← "controller"            │       │
│  │   │     ├─ Xtream (src/core/xtream.ts) ─ NodeTransport ──▶ HTTPS ──▶ Xtream API   │
│  │   │     ├─ Vault  (MacVault → macOS Anahtar Zinciri, account.enc)         │       │
│  │   │     └─ LibraryStore (FileLibraryStore → library-<profil>.json)        │       │
│  │   └─ MediaGateway (src/platform/mac/media.ts) ─────────▶ sağlayıcının medya sunucusu│
│  └──────────────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**En önemli üç sonuç:**

1. **Renderer internete çıkamaz.** CSP'de `connect-src kiyi:` var. Tüm ağ
   trafiği (API ve video) main süreçten geçer.
2. **Kimlik bilgisi renderer'a hiç gelmez.** Video adresi bile main süreçte
   rastgele bir jetona çevrilip (`kiyi://media/9f3c...`) öyle verilir.
3. Arayüz ile backend arasındaki tek sözleşme `platform.call(action, payload)`
   RPC'sidir.

### 4.2 Üç dosya, üç dünya

| Dünya | Dosya | Neyi çalıştırır |
| --- | --- | --- |
| Main (Node) | [main.ts](../src/platform/mac/main.ts) | Pencereyi açar, `kiyi://` protokolünü ve IPC'yi kurar |
| Preload (köprü) | [preload.ts](../src/platform/mac/preload.ts) | Renderer'a yalnızca `window.kiyi.call` sunar |
| Renderer (web) | [main.tsx](../src/main.tsx) | React uygulamasını `#root` içine basar |

Esbuild bunları ayrı ayrı derler: `dist/main.cjs`, `dist/preload.cjs`,
`dist/app/app.js` (bkz. bölüm 11).

### 4.3 Katmanlar ve bağımlılık yönü

```
src/core      Saf mantık. Node'a da tarayıcıya da bağımlı değil.
   ▲          (modeller, Xtream istemcisi, EPG çözümü, kitaplık kuralları, hatalar)
src/runtime   Node'a bağımlı: http, dosya, şifreleme. Session burada.
   ▲
src/platform  Platforma özel: mac/ (Electron) — kardeş depoda webos/
src/ui        React ekranları. Yalnızca core tiplerine ve `Platform` arayüzüne bağlı.
```

`ui`, `platform/mac`'i **import etmez**. Tek istisna
[main.tsx](../src/main.tsx): orada `platform` nesnesini `<App />`'e verir.
Bu, klasik **ports & adapters** desenidir: `Platform` bir port, macOS
adaptörü onun bir gerçeklemesi. Aynı `ui/` kodu TV'de webOS adaptörüyle
çalışır.

```ts
// core/models.ts
export interface Bridge   { call<T>(action: Action, payload?: unknown): Promise<T> }
export interface Platform extends Bridge {
  type: 'mac' | 'tv' | 'preview';
  attach(video: HTMLVideoElement, playback: Playback, onError: (message: string) => void): () => void;
  exit(): void;
}
```

`call` = "arka uçla konuş", `attach` = "video elementine oynatıcıyı bağla",
`exit` = "uygulamayı kapat".

### 4.4 RPC sözleşmesi

Sözleşme [models.ts](../src/core/models.ts) içindeki `Action` ve `Reply<T>`
tipleridir. Cevap her zaman zarflıdır:

```ts
interface Reply<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
```

[adapter.ts](../src/platform/mac/adapter.ts) içindeki `platform.call` zarfı
açar: `ok` ise `data`'yı döner, değilse `Error` fırlatır ve `error.code`'u
`e.code` olarak ekler. UI tarafında bu yüzden `try/catch` veya `.catch(e => ...)`
görürsün.

| Action | Payload | Döner | Not |
| --- | --- | --- | --- |
| `status` | — | `Status` | Kayıtlı hesap var mı? Oturum gerektirmez |
| `login` | `Login` (server, username, password, remember, passphrase?, allowHttp) | `Account` | Doğrular, isteğe bağlı kaydeder |
| `unlock` | `{ passphrase }` | `Account` | Kayıtlı hesabı Vault'tan açar |
| `logout` | `{ forget? }` | `null` | `forget: true` hesabı ve kitaplığı diskten siler |
| `categories` | `{ kind }` | `Category[]` | Oturum gerekir |
| `items` | `{ kind, category? }` | `Item[]` | `category` boşsa tüm katalog |
| `epg` | `{ id }` | `Programme[]` | Kısa program rehberi |
| `detail` | `{ kind, id }` | `Detail` | Film/dizi ayrıntısı + bölümler |
| `play` | `Item` + `{ format, buffer }` | `Playback` | Opak `kiyi://media/...` adresi döner |
| `stop` | — | `null` | Açık medya bağlantılarını kapatır |
| `library` | — | `Library` | Favoriler, geçmiş, tercihler |
| `saveLibrary` | `{ library }` | `Library` | Temizlenmiş halini diske yazar |
| `heartbeat` | — | `true` | Oturum hâlâ açık mı? |
| `mediaStats` | — | `MediaStats \| null` | Akış bilgisi paneli için sayaçlar |

Yeni bir eylem eklemek 4 yeri değiştirmek demektir (bkz. 13.3).

**Hata kodları:** `AppError(code, message)` sunucu tarafında fırlatılır.
`publicError()` bilinmeyen hataları genel bir `INTERNAL` mesajına çevirir; ham
hata veya URL kullanıcıya hiç ulaşmaz. UI'da özel işlenen tek kod `LOCKED`'dır
(oturum kilitlenmiş: oynatmayı durdur, giriş ekranına dön). Diğerleri
mesajıyla ekrana yazılır. Repodaki kodlar: `SERVER`, `INVALID`, `HTTP`,
`AUTH`, `INACTIVE`, `EXPIRED`, `RESPONSE`, `HTTP_STATUS`, `SIZE`, `NETWORK`,
`TLS`, `REDIRECT`, `URL`, `KEYCHAIN`, `PASSPHRASE`, `VAULT`, `STORAGE`,
`PROFILE`, `LOCKED`, `CANCELLED`, `METHOD`, `DENIED`, `INTERNAL`.

---

## 5. Klasör ve dosya haritası

```
macOs/
├─ package.json            komutlar (scripts) ve bağımlılıklar
├─ tsconfig.json           TypeScript ayarı
├─ README.md               kullanım ve kurulum
├─ docs/
│  ├─ PLAN.md              mimari kararlar ve aşamalar
│  ├─ VALIDATION.md        sürüm sürüm ölçümler ve "neden böyle" kayıtları
│  └─ FRONTEND-REHBERI.md  bu belge
├─ src/
│  ├─ main.tsx             renderer giriş noktası
│  ├─ core/                platformdan bağımsız mantık
│  ├─ runtime/             Node'a bağımlı ortak mantık
│  ├─ platform/mac/        Electron'a özel kod (main, preload, adapter, media)
│  └─ ui/                  React ekranları + style.css
├─ tests/core.test.ts      birim testleri
├─ scripts/                build, paketleme, sahte sunucu, e2e testleri
├─ assets/MRT-Player.icns  uygulama simgesi
├─ dist/                   (üretilir, git dışı) derleme çıktısı
├─ release/                (üretilir, git dışı) .app paketi
└─ test-results/           (üretilir, git dışı) e2e ekran görüntüleri
```

`.gitignore`: `node_modules/`, `dist/`, `release/`, `test-results/`, `.env*`,
`*.credentials.*`, `credentials*`, `secrets*` gibi kalıplar.

### 5.1 `src/core/` — saf mantık

| Dosya | Sorumluluk |
| --- | --- |
| [models.ts](../src/core/models.ts) | Tüm tipler (`Item`, `Category`, `Playback`, `Preferences`, `Library`, `Action`, `Reply`, `Platform`...), `DEFAULT_LIBRARY`, `AGENTS`, `itemKey()` |
| [errors.ts](../src/core/errors.ts) | `AppError`, `publicError()`, doğrulama yardımcıları `object()`, `text()`, `id()` |
| [xtream.ts](../src/core/xtream.ts) | `Xtream` sınıfı: `authenticate`, `categories`, `items`, `epg`, `detail`, `stream`; `normalizeCredentials()` ve `parseKind()` |
| [epg.ts](../src/core/epg.ts) | Program rehberi verisini temizler; sağlayıcının base64 veya düz metnini çözer (`decodeText`) |
| [library.ts](../src/core/library.ts) | Favori/geçmiş/tercih kuralları: `normalizeLibrary`, `toggleFavorite`, `remember`, `cleanItem` |

Önemli noktalar:

- `Xtream`, HTTP'yi bilmez. `Transport` arayüzü (`json(url)`) dışarıdan verilir.
  Bu yüzden testte sahte transport takılabilir.
- `Xtream.request()` her çağrıya `username` ve `password` parametrelerini
  ekler ve `encodeURIComponent` uygular.
- `id()` yalnızca `^\d{1,20}$` kabul eder. Test bunu doğrular:
  `client.stream('live', '../1')` hata verir. URL'ye kullanıcı girdisi
  karışmasın diye.
- `items()` `stream_id ?? series_id` alanını kullanır; canlı/film/dizi için
  Xtream farklı alan adları döndürür ve kod bunu tek modele (`Item`) indirger.
- `itemKey(item)` = `"kind:[episode:]id"`. Favori ve geçmişte öğe kimliği
  budur. Film 5 ile bölüm 5 çakışmasın diye tür ve bölüm bilgisi kimliğe girer.
- `normalizeLibrary` **beyaz liste** gibi çalışır: yeni bir nesne kurar, bilinmeyen
  alanları atar, sayıları sınırlar (ses 0–1, favori ≤ 2000, geçmiş ≤ 50). Bu
  yüzden bir ayar alanını burada eklemeyi unutursan ayar sessizce sıfırlanır
  (bkz. 13.2).
- `cleanItem` yalnızca üst veriyi saklar (URL yok). Bunu birim testi doğrular.

### 5.2 `src/runtime/` — Node ortak katmanı

| Dosya | Sorumluluk |
| --- | --- |
| [session.ts](../src/runtime/session.ts) | `Session`: backend'in "controller"ı. Oturum durumunu tutar ve eylemleri dağıtır |
| [http.ts](../src/runtime/http.ts) | `request()` (bağlantı havuzu, yönlendirme, zaman aşımı), `collect()` (boyut sınırlı okuma), `NodeTransport` (JSON çekme); her istek sabit bir `User-Agent` (VLC) bildirir |
| [storage.ts](../src/runtime/storage.ts) | `atomicWrite`, `FileLibraryStore`, `PassphraseVault` (TV için) |

`Session` içinde şunlar olur:

- **Bağımlılıklar dışarıdan verilir:**
  `new Session(vault, store, 'mac', gateway.add, gateway.clear, gateway.stats,
  gateway.useLimit)`. Yani `Session` macOS'u bilmez;
  macOS'a özgü parçalar geri çağrı fonksiyonu olarak enjekte edilir.
- `login()`: her girişte `revision` artar; eski oturumun geç kalan cevabı yeni
  oturumu ezmesin diye kontrol edilir. Profil kimliği
  `sha256(server + "\0" + username)` değerinin ilk 24 hex karakteridir;
  kitaplık dosyası bu kimlikle adlanır.
- `dispatch()`: `status/login/unlock/logout` oturumsuz çalışır. Diğer her
  eylemde `client` ve `account` yoksa `LOCKED` hatası döner.
- Oynatma kararları kullanıcıya bırakılmaz. Ayarlar sayfasında yalnızca ses
  seviyesi ve "kaldığım yerden devam et" vardır. Canlı yayın biçimi, tampon,
  bildirilen oynatıcı ve paralel indirme sabit varsayılanlardır
  (`Session.dispatch('play')`, [http.ts](../src/runtime/http.ts) ve
  `lanesFor` in [media.ts](../src/platform/mac/media.ts)). Eski kayıtlarda kalan
  `liveFormat/agent/buffer/lanes` alanlarını `normalizeLibrary` atar.
- `http.ts`'de dikkat çeken iki karar: (1) **akan (streaming) yanıtlarda boşta
  kalma zaman aşımı yoktur.** Tamponu dolan oynatıcı dakikalarca okumaz ve bu
  normaldir; (2) JSON API çağrılarında yönlendirme yalnızca **aynı origin**'e
  izinlidir (`authOrigin`), böylece kimlik bilgisi başka bir hosta gitmez.

### 5.3 `src/platform/mac/` — Electron kodu

| Dosya | Süreç | Sorumluluk |
| --- | --- | --- |
| [main.ts](../src/platform/mac/main.ts) | main | Uygulama yaşam döngüsü, pencere, menü, `kiyi://` protokolü, IPC, `MacVault` |
| [preload.ts](../src/platform/mac/preload.ts) | preload | `window.kiyi.call` köprüsü ve eylem beyaz listesi |
| [adapter.ts](../src/platform/mac/adapter.ts) | renderer | `platform` nesnesi: `call` (köprüyü sarar), `attach` (oynatıcı motorlarını yönetir), `exit` |
| [media.ts](../src/platform/mac/media.ts) | main | `MediaGateway`: medya vekili (bölüm 8) |

`main.ts` neler yapar:

1. `protocol.registerSchemesAsPrivileged` ile `kiyi://` şemasını kaydeder.
2. Kayıtlı hesap için `MacVault` (safeStorage) ve kitaplık için
   `FileLibraryStore` kurar; `Session`'ı bunlarla oluşturur.
3. `protocol.handle('kiyi', ...)`:
   - `kiyi://app/...` → yalnızca `index.html`, `app.js`, `app.css` dosyalarını
     `dist/app/` içinden sunar. Yanıta CSP başlığı ekler.
   - `kiyi://media/<jeton>` → `MediaGateway.handle()`.
4. Tüm izin isteklerini reddeder; yeni pencere açmayı ve sayfa
   yönlendirmesini engeller.
5. `ipcMain.handle('kiyi:call')`: gönderenin ana pencerenin ana çerçevesi ve
   `app` host'u olduğunu doğrular. Sonra `runtime.call(action, payload)`.
6. Pencere kapanınca `logout` çağırır (oturum ve medya bağlantıları kapanır),
   `window-all-closed` olunca uygulama çıkar.
7. Eski adla ("Kıyı Player") veri klasörü varsa onu kullanmaya devam eder.

### 5.4 `src/ui/` — React ekranları

| Dosya | Bileşen | Ne gösterir |
| --- | --- | --- |
| [App.tsx](../src/ui/App.tsx) | `App`, `Workspace` | Kök: giriş yapılmamışsa `Login`, yapılmışsa `Workspace` (kenar çubuğu, liste, oynatıcı alanı). Uygulamanın beyni |
| [Login.tsx](../src/ui/Login.tsx) | `Login` | Giriş formu; kayıtlı hesap varsa "Kilidi aç" |
| [Player.tsx](../src/ui/Player.tsx) | `Player` | `<video>` + kontroller + hata/yükleniyor durumu + tam ekran + klavye |
| [PlaybackStats.tsx](../src/ui/PlaybackStats.tsx) | `PlaybackStats` | "Akış bilgisi" paneli (çözünürlük, tampon, kare kaybı, sunucu hızı...) |
| [Guide.tsx](../src/ui/Guide.tsx) | `Guide` | Canlı kanalın program rehberi (EPG) |
| [Details.tsx](../src/ui/Details.tsx) | `Details` | Film/dizi ayrıntı penceresi, sezon ve bölüm listesi |
| [Settings.tsx](../src/ui/Settings.tsx) | `Settings` | Tercihler formu |
| [Modal.tsx](../src/ui/Modal.tsx) | `Modal` | Odak tuzağı olan iletişim penceresi (Tab dışarı çıkmaz) |
| [Icon.tsx](../src/ui/Icon.tsx) | `Icon` | SVG simge; yol verileri tek bir `paths` tablosunda |
| [navigation.ts](../src/ui/navigation.ts) | `useRemote` | TV kumandası yön tuşu gezinmesi. **macOS'ta kullanılmıyor** (bkz. bölüm 15) |
| [style.css](../src/ui/style.css) | — | Tüm stiller |

### 5.5 `scripts/` ve `tests/`

| Dosya | Amaç |
| --- | --- |
| [build.mjs](../scripts/build.mjs) | esbuild ile derleme (bölüm 11) |
| [package.mjs](../scripts/package.mjs) | `.app` üretimi ve imzalama |
| [shared.mjs](../scripts/shared.mjs) | macOS ↔ webOS ortak dosya kontrolü/eşitleme |
| [fixture.ts](../scripts/fixture.ts) | **Sahte Xtream sunucusu** (bölüm 12) |
| [electron-test-main.cjs](../scripts/electron-test-main.cjs) | Testlerde geçici veri klasörüyle uygulamayı başlatan giriş |
| [ui-checks.ts](../scripts/ui-checks.ts) | Ortak arayüz senaryosu (`checkMvp`) |
| `scripts/e2e*.ts`, `integration.ts`, `keychain.ts` | Otomatik testler (bölüm 12) |
| [icons.py](../scripts/icons.py) | Yalnızca simge yeniden üretimi için (Python/Pillow) |
| [core.test.ts](../tests/core.test.ts) | 6 birim testi |

---

## 6. Uçtan uca akışlar

### 6.1 Uygulama açılışı

1. `npm start` → build → `electron .` → `dist/main.cjs` çalışır.
2. `app.whenReady()` → `MediaGateway`, `Session`, protokol ve IPC kurulur →
   pencere `kiyi://app/index.html` adresini yükler.
3. Chromium `index.html`'i, o da `app.js`/`app.css`'i alır.
4. [main.tsx](../src/main.tsx) `createRoot(#root).render(<App platform={platform}/>)`.
5. `App` içinde `account` state'i boş olduğu için `Login` gösterilir.

### 6.2 Giriş

```
Login.tsx  useEffect → platform.call('status') → { saved, requiresPassphrase, platform }
           ├ saved && !manual  → submit ⇒ call('unlock', { passphrase })
           └ değilse           → submit ⇒ call('login', { server, username, password, remember, passphrase, allowHttp })

main süreç Session.login():
   revision++  ·  client/account/medya temizlenir
   normalizeCredentials()    ← URL biçimi, http ise onay, kullanıcı adı/şifre sınırı
   new Xtream(credentials, new NodeTransport()).authenticate()
        └ GET .../player_api.php?username=..&password=..   → user_info.auth === 1 ?
   remember ise vault.save() (Anahtar Zinciri), değilse vault.clear()
   mediaLimit(max_connections)     ← medya vekiline hesabın bağlantı limitini bildirir
   account = { expires, connections, maxConnections, profile }

Login.tsx  onLogin(account) → App: setAccount → <Workspace key={account.profile} .../>
```

`key={account.profile}`: hesap değişince `Workspace` **sıfırdan** kurulur, eski
hesabın tüm state'i gider. React'te "state'i sıfırla" demenin standart yolu.

macOS'ta `requiresPassphrase` her zaman `false`. Kilit parolası yalnızca TV
sürümünde istenir.

### 6.3 Katalog: kategori ve içerik listesi

`Workspace` içinde iki effect zinciri vardır:

1. `[view, reload]` değişince `call('categories', { kind: view })`. Cevap gelince
   ilk kategori otomatik seçilir. **Bilerek:** tüm kataloğu çekmek yüz binlerce
   satır olabilir. Fixture testi 50.000 kanal + 40.000 film + 11.000 dizi
   kataloğunu işleyebiliyor, ama uygulama yine de ilk açılışta yalnızca ilk
   kategoriyi ister.
2. `[view, category, reload]` değişince `call('items', { kind, category })`.
   `category === ''` ("Tüm içerikler") ise Session `category_id`'yi hiç
   göndermez ve sağlayıcı tüm kataloğu döner (üst sınır: 48 MB yanıt).

Sonrası tamamen istemci tarafıdır:

- **Arama** sunucuya gitmez. `filtered` = yüklü listeyi `toLocaleLowerCase('tr-TR')`
  ile süzer. Türkçe `İ/ı` farkı yüzünden `tr-TR` yerel ayarı önemlidir.
- **Sayfalama:** `filtered.slice(0, limit)`; "Daha fazla göster" `limit`'i 60
  artırır. Sanal liste yok; DOM'a en fazla `limit` kadar öğe basılır.
- **Favoriler ve Son izlenenler** sunucudan değil, `library` state'inden gelir.

### 6.4 Oynatma

```
Kullanıcı bir kanala/bölüme tıklar
 App.select(item): canlı veya bölümse play(item), film/dizi ise <Details> açılır
  └ App.play(item)
      └ platform.call('play', item)
          └ IPC 'kiyi:call' → Session.dispatch('play')
              ├ Xtream.stream() → "http://sunucu/live/KULLANICI/SIFRE/123.m3u8"   ← şifre burada
              ├ MediaGateway.add(url) → "kiyi://media/9f3c...."                    ← opak jeton
              └ Playback { url, format: 'hls'|'ts'|'file', live, engine?: 'js', buffer }
      └ setPlaying({ item, playback, resumeAt })  → <Player key={playback.url}> çizilir
          └ effect: platform.attach(videoElement, playback, hataCallback)
              └ video.src = 'kiyi://media/9f3c....'
                  └ Chromium isteği → protocol.handle('kiyi') → MediaGateway.handle()
                      ├ jetonu gerçek URL'ye çevirir, sağlayıcıdan çeker
                      ├ .m3u8 ise içindeki her adresi yeniden jetona çevirip döner
                      └ değilse gövdeyi akıtır (yeniden deneme, sıra, paralel şerit, sayaç)
```

Diğer noktalar:

- Format kararı `Session`'da verilir ve sabittir: canlıda her zaman `.m3u8`,
  `engine: 'js'` (hls.js) ve `buffer: 'large'`. Filmde uzantı Xtream'in
  `container_extension` değeridir (yoksa `mp4`).
- Her `play` ve `stop`, önce `clearMedia()` çağırır: eski jetonlar silinir ve
  eski akışın açık **yukarı akış bağlantıları kapatılır** (sağlayıcının bağlantı
  hakkı hemen serbest kalsın).
- `Player` `key={playback.url}` ile çizilir; yeni URL yeni bileşen demektir.
- Film yeniden açılırsa `resumeAt` = geçmişteki konum. Player `canplay`'de,
  konum süreden 5 sn'den fazla kısaysa ve "kaldığım yerden devam" açıksa oraya
  sarar.

### 6.5 Kaydetme: favori, geçmiş, ayar

Bunların hepsi tek nesnedir: `Library { favorites, recent, preferences }`.

```
Kalbe tıklama → update(current => toggleFavorite(current, item))
   ├ normalizeLibrary(...)         doğrula ve temizle
   ├ libraryRef.current = next     zamanlayıcıların göreceği en güncel değer
   ├ setLibrary(next)              ekranı güncelle
   └ 400 ms sessizlik sonra queueSave()
         └ saveQueue = saveQueue.then(() => call('saveLibrary', { library: snapshot }))
                 └ Session → FileLibraryStore.write() → atomicWrite (geçici dosya + rename, 0600)
```

- **Debounce:** peş peşe değişiklikte yalnızca sonuncusu yazılır.
- **Seri kuyruk:** kayıt istekleri bir Promise zincirinde sıralanır; eski bir
  kayıt yeni olanı ezmez.
- **Hata görünürlüğü:** yazma başarısız olursa üstte "Kaydı yeniden dene"
  şeridi çıkar (`storageError`).
- **Ne zaman zorla yazılır (`flush`):** sekme gizlenince
  (`visibilitychange`) ve çıkış yaparken.
- İzleme konumu: film/bölümde her 30 sn'de bir, kapatınca ve çıkışta yazılır.
  Canlı yayında konum 0'dır. `timeupdate` çok sık gelir; bu yüzden state
  güncellemesi 500 ms'de bir yapılır (aksi halde React sürekli render eder).

### 6.6 "Geri" (Esc) davranışı

`App.tsx` pencereye **yakalama fazında** (`addEventListener(..., true)`) bir
`keydown` dinleyicisi koyar ve `Escape` (TV'de `461`) tuşunu sırayla şu
katmanlara uygular; ilk uyan çalışır:

1. Tam ekran açıksa kapat
2. Ayrıntı penceresi açıksa kapat
3. Çıkış onayı açıksa kapat
4. Arama kutusu doluysa temizle
5. Oynatıcı açık veya bağlanıyorsa durdur
6. Canlı TV dışındaki bir ekrandaysa Canlı TV'ye dön
7. Kategori seçiliyse "Tüm içerikler"e dön
8. Yalnızca TV'de: çıkış onayı iste

Bu "geri yığını"dır. Yeni bir katman (yeni modal gibi) eklersen bu zincire de
eklenmelidir.

### 6.7 Çıkış ve kilitleme

- **Oturumu kilitle:** `logout()` → (film ise konumu kaydet) → `flush()` →
  `stop()` → `call('logout')` → `App`'in `account` state'i boşalır → giriş
  ekranı. Kayıtlı hesap Anahtar Zinciri'nde kalır ve giriş ekranı "Tekrar
  hoş geldiniz" gösterir.
- **Hesabı cihazdan sil:** `logout(true)` → main süreç hem `account.enc`'i hem
  bütün `library-*.json` dosyalarını siler.
- `logout` sırasında `forgetting.current = true` yapılır; bu, kapanış
  esnasında araya giren `update()` çağrılarının yeni veri yazmasını engeller.
- Her 15 sn'de `heartbeat` gider. Cevap `LOCKED` ise (main süreç oturumu
  kaybetmişse) arayüz kendini giriş ekranına döndürür.

---

## 7. Arayüz durum yönetimi (Workspace)

Global bir store yoktur. Durum `Workspace` bileşeninde toplanır; alt
bileşenlere **props** ile (değer ve geri çağrı fonksiyonu olarak) aşağı geçilir.
Küçük bir uygulama için bilinçli, sade bir tercih.

| State | Anlamı |
| --- | --- |
| `view` | Aktif ekran: `live`, `vod`, `series`, `favorites`, `recent`, `settings` |
| `category` | Seçili kategori kimliği; `null` = henüz yüklenmedi, `''` = tümü |
| `query` | Arama metni |
| `categories`, `items` | Sunucudan gelen listeler |
| `loading`, `error` | Liste yükleme durumu |
| `reload` | Sayıcı; artırılınca effect'ler yeniden çalışır ("Listeyi yenile") |
| `limit` | Ekrandaki öğe sayısı (60'ar 60'ar artar) |
| `library`, `ready`, `storageError` | Favori/geçmiş/tercih ve kayıt durumu |
| `detail` | Ayrıntı penceresi için seçili film/dizi |
| `playing` | `{ item, playback, resumeAt }`: açık oynatma |
| `connecting`, `playError` | Bağlanıyor / bağlanamadı durumu |
| `streamStarted` | İlk kare gösterilince true; EPG bunu bekler |
| `full`, `confirmExit` | Tam ekran / çıkış onayı |

Ref'ler (render tetiklemez): `libraryRef`, `saveTimer`, `saveQueue`,
`lastSaveError`, `forgetting`, `playRevision`, `alive`. `alive`, bileşen
kalktıktan sonra gelen asenkron cevapların state yazmasını engeller.

Okuma ipuçları:

- `navigate(next)`: aynı ekrana tekrar basılırsa listeyi yeniler (`reload++`),
  farklıysa listeleri sıfırlayıp yeni ekrana geçer.
- `source` = ekrana göre kaynak liste (favoriler / geçmiş / sunucudan gelen
  `items`). `filtered` = arama uygulanmış hali. Hepsi `useMemo` ile.
- `select(item)` canlıysa veya bölümse doğrudan oynatır; film/dizi ise `Details`
  açar.
- Ekrandaki büyük JSX, iç içe koşullu (`? :`) ifadelerle boş/hata/yükleniyor
  durumlarını seçer. Okurken: **önce yükleniyor, sonra hata, sonra boş, sonra
  liste.**

`Player` kendi yerel state'ine sahiptir (yükleniyor, duraklatıldı, konum,
hata, kontrollerin görünürlüğü...). Bunlar yalnızca oynatıcıyı ilgilendirir
ve yukarı taşınmamıştır. Yukarıya yalnızca şunlar çıkar: `onProgress`,
`onStarted`, `onFull`, `onPreference`, `onClose`, `onRetry`.

---

## 8. Oynatma altyapısı (en zor kısım)

Kodun en yoğun bölümü burasıdır ve büyük kısmı gerçek bir sağlayıcı sorununu
adım adım çözerek büyümüştür. **"Neden böyle?" sorusunun cevabı
[VALIDATION.md](VALIDATION.md) içinde sürüm sürüm anlatılıyor.** Buradaki özet,
o kayıtların haritasıdır.

### 8.1 Üç oynatma motoru

`adapter.ts`'deki `attach()` üç yoldan birini seçer:

| Motor | Ne zaman | Nasıl |
| --- | --- | --- |
| **Yerel** (`video.src`) | Film/dosya. Canlı yayın artık buraya gelmez | Element kendi yükler. Hata olursa yeniden açılır, film kaldığı yere döner |
| **hls.js** | Canlı yayın, her zaman (`engine: 'js'`). **Varsayılan** | JS kütüphanesi manifesti çözer, MSE ile besler |
| **mpegts.js** | Yalnızca uzantısı `ts` olan dosya. `Session` canlıda artık `.ts` istemez | JS kütüphanesi ham TS akışını çözer |

Ortak davranış:

- **Sınırlı yeniden deneme:** `RETRIES = 4`, gecikme `400 ms × deneme`. Bütçe,
  10 sn kesintisiz oynatmadan sonra yenilenir. Kısa kesintide ekrana hata
  basılmaz.
- Her motor bir **dispose fonksiyonu** döndürür: dinleyiciler, zamanlayıcılar
  ve motor nesnesi temizlenir. Kanal değişince eski oynatıcı tam kapanır.
- Hata `onError(mesaj)` ile `Player`'a bildirilir; `Player` "Yeniden dene"
  düğmesi gösterir.

### 8.2 Medya vekili (`MediaGateway`)

Renderer'ın tek video kaynağı `kiyi://media/<jeton>` adresleridir. Vekil şunları
yapar:

| Görev | Nasıl |
| --- | --- |
| Adres gizleme | Jeton = 24 rastgele bayt (hex). Jeton→URL haritası bellekte, en fazla 10.000 giriş |
| Manifest yeniden yazma | `.m3u8` içeriğindeki her URL ve `URI="..."` alanı yeniden jetona çevrilir |
| Yeniden deneme | 403, 429, 500, 502, 503, 504 ve ağ hataları için 3 kez, artan gecikmeyle |
| Tek bağlantılı hesap | `max_connections === 1` ise istekler sıraya girer, yenisi öncekinin kapanmasını bekler (en çok 8 sn) |
| Paralel şerit | Sunucu `Range` destekliyorsa büyük dosyayı 2 MB dilimlerle birkaç bağlantıdan çeker. Genişlik `lanesFor(max_connections)` ile hesaptan gelir: sınırdan bir eksik, en çok 4 |
| Temizlik | `clear()`: jetonları siler, `generation` sayacını artırır, açık yukarı akış yanıtlarını kapatır |
| Ölçüm | `stats()`: `delivered`, `requests`, `failures`, `lastStatus`, `slowestMs`, `peakBps`, `retries`, `open` |

Paralel şerit yalnızca `206` yanıt + geçerli `Content-Range` + en az 8 MB
parça + hesabın en az 3 eşzamanlı bağlantısı olduğunda devreye girer (bir yuva
oynatıcının kendi yan istekleri için boş kalır). Kısa HLS parçalarında
gidiş-dönüş maliyeti kazancı geçeceği için kullanılmaz.

`add`, `clear`, `stats` gibi metotlar **ok fonksiyonu alanı** (`add = (url) =>
...`) olarak yazılmıştır. Çünkü `Session`'a `gateway.add` biçiminde, nesne
bağlamı olmadan geri çağrı olarak verilirler ve `this` kaybolmamalıdır.

### 8.3 Tampon ve kesinti stratejileri

- **Yerel motor, film, `buffer: 'large'` (her zaman):** `waiting` olayında oynatmayı durdurur
  ve **10 sn görüntü birikene kadar** bekler (`CUSHION = 10`). Chromium,
  duraklatılmış elementte yaklaşık 15–16 sn'den fazlasını okumaz; hedef bunun
  üstündeyse oynatıcı sonsuza kadar asılı kalırdı (VALIDATION 0.2.1). Bu yüzden
  iki güvenlik freni vardır: tampon büyümesi 4 ölçüm boyunca durursa veya bekleme
  15 sn'yi aşarsa oynatma **mutlaka** devam eder.
- **hls.js:** `large` iken canlı kenardan 4 yerine 7 parça geriden başlar
  (`normal` kodda durur, ama `Session` hiç üretmez). Ayrıca her iki seçenekte de `maxBufferSize` 120 MB'tır (4K parçalar
  büyük olduğu için varsayılan 60 MB kısa kalıyordu).
- **mpegts.js:** `large` iken giriş yığını 512 KB yerine 2 MB. Canlı
  kenarı kovalama (`liveBufferLatencyChasing`) bilerek kapalı.
- **Yerel motor, canlı HLS:** Chromium tamponu kendisi yönettiği için `buffer`
  bu yolda etkisizdir. Canlı yayın artık bu yola girmediği için pratikte önemsizdir.

### 8.4 Akış bilgisi paneli ve teşhis

`PlaybackStats` her saniye örnek alır: çözünürlük, ön tampon, atlanan kare,
ilk görüntü süresi, kesinti sayısı ve süresi; ses/görüntü çözülmüş bayt
sayıları; `mediaStats` üzerinden sunucu hızı, en yüksek hız, açık bağlantı,
sunucu hatası, kurtarılan istek. Bu panel, "takılma ağdan mı, sağlayıcıdan mı,
codec'ten mi?" sorusunu cevaplamak için yazıldı.

Codec sınırı (VALIDATION 0.1.7 ölçümü): Chromium **AC-3, E-AC-3, MP2, DTS**
seslerini çözmez. TV'lerde lisanslı Dolby çözücüsü olduğu için aynı yayın
TV'de akıcı, Mac'te sorunlu olabilir. Panelde "Ses çözümü: Yok · codec
desteklenmiyor" satırı bunu gösterir.

### 8.5 `Player.tsx` özeti

- Video olayları (`onWaiting`, `onPlaying`, `onError`, `onTimeUpdate`...) doğrudan
  `<video>` üzerine JSX olarak bağlıdır.
- **Zamanlayıcı savunmaları:** 25 sn içinde veri gelmezse "yanıt vermiyor";
  `waiting` 20 sn sürerse "yayın kesildi"; kısa beklemelerde (800 ms altı)
  yükleniyor göstergesi çıkmaz.
- **`timings` bir ref'tir**, state değil: ilk kare zamanı, kesinti sayısı gibi
  sayaçlar sık güncellenir ama ekranı etkilemez; panel açıkken okunur.
- **Klavye:** Boşluk oynat/duraklat, `F` tam ekran, `M` sessiz, tam ekranda
  ←/→ 10 sn sarma. Bir `role="dialog"` açıksa (Modal) tuşlar yok sayılır. TV
  tuş kodları (415 oynat, 19 duraklat, 413 durdur, 417/412 ileri/geri, 461 geri)
  ortak kodda durur ve macOS'ta tetiklenmez.
- **Tam ekran:** macOS'ta gerçek Fullscreen API (`requestFullscreen`),
  `fullscreenchange` olayıyla state'e geri senkronlanır. Tam ekranda
  kontroller 4,5 sn sonra saklanır.

---

## 9. Güvenlik modeli

Bu repo güvenliği "sonradan eklenen" değil, tasarım kararı olarak ele alır.
Backend geliştirici gözüyle kontrol listesi:

| Önlem | Yeri | Neyi engeller |
| --- | --- | --- |
| `contextIsolation`, `sandbox`, `nodeIntegration: false` | [main.ts](../src/platform/mac/main.ts) `BrowserWindow` | Arayüz koduna Node/dosya sistemi erişimi |
| Eylem beyaz listesi | [preload.ts](../src/platform/mac/preload.ts) | Keyfi IPC çağrısı |
| Gönderen doğrulaması (pencere + ana çerçeve + `app` host) | `ipcMain.handle` | Başka çerçevenin/sayfanın backend'i çağırması |
| CSP: `default-src 'none'`, `script-src 'self'`, `connect-src kiyi:` | `protocol.handle` yanıt başlığı | Dış script, dış ağ bağlantısı |
| İzin, yeni pencere ve yönlendirme reddi | `main.ts` | Kamera/mikrofon izni, pop-up, sayfadan çıkış |
| `kiyi://app` yalnızca 3 dosya sunar | `protocol.handle` | Yol gezinme (path traversal) |
| Opak medya jetonları | [media.ts](../src/platform/mac/media.ts) | Şifre içeren URL'nin arayüze sızması |
| `id()`, `parseKind()`, `normalizeCredentials()` | `core` | URL/parametre enjeksiyonu |
| `publicError()` | [errors.ts](../src/core/errors.ts) | Ham hata veya URL'nin kullanıcıya gitmesi |
| Yönlendirme sınırı, TLS doğrulaması açık | [http.ts](../src/runtime/http.ts) | https→http düşürme, başka hosta kimlik sızması |
| `safeStorage` (Anahtar Zinciri) + atomik yazma, `0600` | `MacVault`, `atomicWrite` | Şifrenin düz metin saklanması |
| `cleanItem` URL saklamaz | [library.ts](../src/core/library.ts) | Diske kimlik bilgili URL yazılması |
| User-Agent yalnızca ön tanımlı listeden | `AGENTS` | Header enjeksiyonu |
| HTTP için açık onay kutusu | `Login`, `normalizeCredentials` | Kullanıcının bilmeden açık metin kullanması |
| Testler her koşuda rastgele kimlik üretir | [fixture.ts](../scripts/fixture.ts) | Kodda/logda gerçek hesap bilgisi |

Kod yazarken uyulacak kurallar:

- Yeni bir dış girdi (Xtream alanı, IPC payload'ı) geliyorsa `object()`,
  `text()`, `id()` ile temizle.
- Hata mesajına URL, kullanıcı adı veya ham sunucu cevabı koyma.
- Renderer'a asla gerçek medya URL'si verme.
- `.env`, komut satırı veya test dosyasına gerçek hesap yazma.

---

## 10. Veri saklama

Kök klasör Electron `userData` klasörüdür (macOS'ta
`~/Library/Application Support/` altında). `main.ts`, eski adla
`Kıyı Player` klasörü varsa onu kullanmaya devam eder; böylece eski
kurulumdaki hesap ve ayarlar kaybolmaz.

| Dosya | İçerik | Koruma |
| --- | --- | --- |
| `account.enc` | Şifreli `{ server, username, password }` | `safeStorage` (Anahtar Zinciri anahtarı) |
| `library-<24 hex>.json` | `{ favorites, recent, preferences }` | Düz JSON, `0600`. **URL içermez** |

- `<24 hex>` profil kimliğidir: `sha256(server + "\0" + username)` özetinin
  ilk 24 karakteri. Aynı Mac'te farklı hesapların favorileri karışmaz.
- Yazma: geçici dosyaya yaz, sonra `rename` (atomik). Yarım yazılmış dosya
  görmezsin.
- `PassphraseVault` (PBKDF2 600.000 tur + AES-256-GCM) `storage.ts`'te durur
  ama **yalnızca TV sürümü kullanır**; macOS `MacVault` kullanır.
- Testlerde `KIYI_TEST_MODE=1` ve `KIYI_TEST_DATA=<mutlak yol>` ile geçici
  bir klasör kullanılır; gerçek profilin verisine dokunulmaz.

---

## 11. Build, çalıştırma, paketleme

### 11.1 Komutlar

```sh
cd /Users/a1/Projects/IpTv/macOs
npm ci             # bağımlılıkları kilit dosyasından kur
npm run typecheck  # yalnızca tip denetimi (tsc --noEmit)
npm test           # birim testleri
npm run build      # dist/ üret
npm start          # build + uygulamayı aç
npm run check      # typecheck + test + build  (sürüm kapısı)
npm run package    # check + release/.../MRT-Player.app
```

Gereksinim: Node 22, npm 10, Apple Silicon macOS.

### 11.2 Build ne üretir?

[build.mjs](../scripts/build.mjs) esbuild'i **dört kez** çağırır:

| Girdi | Çıktı | Not |
| --- | --- | --- |
| `src/main.tsx` | `dist/app/app.js` (+ `app.css`) | Tarayıcı hedefi, tek dosya (IIFE), minify, Chrome 120. React, hls.js ve mpegts.js içindedir (~1 MB) |
| (string) | `dist/app/index.html` | Betik içinde sabit metin olarak yazılır |
| `src/platform/mac/main.ts` | `dist/main.cjs` | Node 22, CommonJS, `electron` dışarıda |
| `src/platform/mac/preload.ts` | `dist/preload.cjs` | Aynı |

**Kritik bilgi:** esbuild tipleri **denetlemez**, yalnızca siler. Yani tip
hatası olan kod bile derlenir. Tipleri `npm run typecheck` (veya
`npm run check`) denetler. Değişiklikten sonra mutlaka çalıştır.

`package.json` içindeki `"main": "dist/main.cjs"` alanı `electron .` komutunun
giriş noktasıdır.

### 11.3 Paketleme

[package.mjs](../scripts/package.mjs): `dist/`'i `release/stage/`'e kopyalar,
minimal bir `package.json` yazar, `@electron/packager` ile arm64 `.app`
üretir (`asar: true`, paket kimliği `com.kiyi.player.mac`), ardından
**ad hoc imza** atar (`codesign --sign -`) ve doğrular. Apple notarizasyonu
yoktur; macOS ilk açılışta engellerse Finder'da Control+tık → Aç denir
(README'de yazıyor).

`node_modules` pakete girmez, çünkü renderer bağımlılıkları zaten bundle
içindedir ve main süreç yalnızca Node yerleşikleri ile `electron`'u kullanır.

### 11.4 Hata ayıklama

- Main süreçteki `console.log` çıktısı `npm start` çalıştırdığın terminale düşer.
- **Renderer için DevTools'a menüden erişemezsin;** menüde yalnızca
  MRT-Player, Düzen ve Pencere var. Denemek için `main.ts` içindeki `create()`
  fonksiyonunda `window.loadURL(...)` satırından sonra geçici olarak şu satırı
  ekleyebilirsin:

  ```ts
  window.webContents.openDevTools({ mode: 'detach' });
  ```

  Bu öneri, repoda olmayan bir değişikliktir ve ben çalıştırıp doğrulamadım.
  Commit'e koyma.
- Hot reload olmadığı için her kod değişikliğinde `Cmd+Q`, sonra `npm start`.
- Gerçek Xtream hesabın yoksa [fixture.ts](../scripts/fixture.ts) içindeki
  `createFixture()` yerel bir sahte Xtream sunucusu açar ve rastgele hesap
  döner (`fixture.credentials`). Elle deneme için kendi küçük scriptinden
  çağırabilirsin. Bunu bağımsız script olarak çalıştırmayı **doğrulamadım**;
  e2e testleri bu fonksiyonu böyle kullanıyor. Girişte "HTTP" onay kutusunu
  işaretlemen gerekir, çünkü fixture `http://127.0.0.1:...` adresinde çalışır.

---

## 12. Test stratejisi

| Katman | Komut | Ne yapar |
| --- | --- | --- |
| Tip denetimi | `npm run typecheck` | `src`, `tests`, `scripts/*.ts` |
| Birim | `npm test` | `tests/core.test.ts`: 6 test; Electron açmaz, birkaç yüz ms |
| Entegrasyon | `npm run test:integration` | Sahte sunucuya karşı `Xtream` + `MediaGateway`; büyük katalog |
| Uçtan uca | `npm run test:e2e` ve diğerleri | Gerçek Electron penceresi + Playwright + sahte sunucu |

**Bugün (2026-09-30) çalıştırdım:** `npm run typecheck` temiz, `npm test` 6/6 geçti.
E2E testlerini çalıştırmadım.

### 12.1 Birim testleri (`tests/core.test.ts`)

Node'un yerleşik `node:test` ve `assert/strict` kütüphaneleriyle yazılmıştır.
Testler:

1. Sunucu normalizasyonu, HTTP onayı, güvensiz URL'ler
2. EPG: base64 Türkçe metin çözümü, zaman ve sıralama
3. Kitaplık URL saklamaz, favori/geçmiş kuralları, Türkçe arama
4. API kimlik doğrulama ve ID enjeksiyonu
5. Akan medya gövdesi boşta kalma zaman aşımına uğramaz
6. Kanal değişimi açık yayın bağlantılarını hemen kapatır

Bu testlerden sonuncusu gerçek bir yerel HTTP sunucusu açar; yani "birim"
testin sınırı bulanıktır. Backend'deki entegrasyon testine benzer.

### 12.2 Sahte Xtream sunucusu (`scripts/fixture.ts`)

`createFixture(options)`:

- Rastgele kullanıcı adı ve şifre üretir (her koşuda değişir).
- `ffmpeg-static` ile yerelde 12 sn'lik sentetik video üretir (renk deseni +
  sinüs sesi): `.mp4`, HLS parçaları ve `.ts`.
- `127.0.0.1` üzerinde rastgele portta bir HTTP(S) sunucusu açar; `player_api.php`
  eylemlerini ve `/live`, `/movie`, `/series` yollarını taklit eder. `Range`
  destekler.
- Seçenekler (`options`): `tls`, `cors`, `catalogSizes`, `videoSize`,
  `videoBitrate`, `videoDuration`, `live` (kayan pencereli canlı HLS), `audio`
  (`aac`/`ac3`/`eac3`/`mp2`), `video` (`h264`/`hevc`/`hevc10`),
  `perConnectionBps` (bağlantı başına hız sınırı), `oneStreamOnly` (tek
  bağlantılı hesap), `uneven` (dalgalanan hız).
- HEVC üretimi `hevc_videotoolbox` kullanır, yani yalnızca macOS'ta çalışır.

### 12.3 E2E komutları

`test:integration` dışındakilerin hepsi gerçek bir Electron penceresi açar
(görsel oturum gerekir). `test:*` komutlarının çoğu önce `npm run build`
çalıştırır.

| Komut | Neyi doğrular |
| --- | --- |
| `test:e2e` | Girişten videoya: giriş, katalog, hls.js ile canlı HLS oynatma, akış paneli, kaldırılan ayarların sayfada olmaması, her isteğin VLC User-Agent'ı bildirmesi, ardından `checkMvp`: duraklat, ses, tam ekran, favori, arama, boş kategori, film, sarma, dizi/sezon, geçmiş, ayarlar, kilitleme |
| `test:4k` | Yerel 3840×2160 HLS: oynatma ilerliyor mu, kare kaybı, panel |
| `test:switch` | Kanal değişim süresi ve bağlantının yeniden kullanılması |
| `test:recover` | Kayan pencereli canlı yayında bağlantı kopması, sunucu tamamen kapanması |
| `test:lanes` | Paralel indirme: 2 yuvalı hesap (tek şerit) vs 5 yuvalı hesap (4 şerit) |
| `test:solo` | Tek bağlantılı hesapta iki isteğin çakışması |
| `test:cushion`, `test:cushion:safety` | Büyük tampon beklemesi ve **asla kilitlenmemesi** |
| `test:rate` | Hız ölçümünün doğruluğu |
| `test:keychain` | Kayıtlı hesap, Anahtar Zinciri, kilit açma, silme |
| `test:integration` | Electron'suz: Xtream + vekil + büyük katalog |
| `test:packaged`, `test:4k:packaged` | Aynı testler, ama `release/` içindeki gerçek `.app` ile (`KIYI_TEST_PACKAGED=1`) |

Her e2e betiği aynı şekilde çalışır: `createFixture()` → geçici `userData`
klasörü (`KIYI_TEST_DATA`) → `electron.launch(...)` → Playwright ile
`page.getByLabel('Sunucu adresi').fill(...)`, `getByRole('button', ...).click()`
→ `expect(...)` → kapat ve temizle.

**Bir düzeltmeyi test etmek için "önce kır" ilkesi:** VALIDATION.md içinde
birçok kayıtta düzeltmenin, düzeltmesiz kodda **başarısız olduğunun** ayrıca
gösterildiğini görürsün (örn. `test:lanes` tek bağlantının gerçekten
takıldığını da doğrular). Yeni bir test yazarken bu alışkanlığı sürdür.

---

## 13. Geliştirme akışı ve tarifler

### 13.1 Günlük döngü

1. Değişikliği yap.
2. `npm run typecheck && npm test` (hızlı, saniyeler).
3. Arayüz değiştiyse `npm start` ile elle bak.
4. Oynatma/ağ katmanına dokunduysan ilgili `test:*` komutunu çalıştır
   (`test:e2e` genelde yeterli başlangıçtır).
5. Bitirmeden `npm run check`.

> **Öneri:** Depoda henüz hiç commit yok (`git status`: tüm dosyalar
> untracked). Denemeye başlamadan önce mevcut hali commit'lemeni öneririm ki
> her değişikliği `git diff` ile görebilir ve geri alabilesin.

### 13.2 Tarif: yeni bir ayar (Preference) eklemek

Örnek: "Sayfa başına öğe sayısı" (bugün `60` sabit kodlu).

1. [models.ts](../src/core/models.ts): `Preferences` arayüzüne alanı ekle ve
   `DEFAULT_LIBRARY.preferences` içine varsayılan değeri yaz.
2. [library.ts](../src/core/library.ts) → `normalizeLibrary`: alanı **doğrula ve
   varsayılanla birleştir.** Bu adım şart: fonksiyon yeni nesne kurduğu için
   burada yazmazsan alan kaydedildiğinde sessizce silinir.
3. [Settings.tsx](../src/ui/Settings.tsx): bir `<label>` + `<select>` ekle;
   `onChange`'de `onPreference({ alan: ... })` çağır.
4. Kullanılacağı yerde oku: `library.preferences.alan`. Örneğin `App.tsx`'te
   `useState(60)` yerine bu değeri kullan.
5. Ayar **main süreci de etkiliyorsa** (ağ, medya vekili) `Session.dispatch`
   içindeki `library` ve `saveLibrary` durumlarında ilgili bileşene ilet. Dikkat:
   oynatma ayarlarını (biçim, tampon, User-Agent, paralel indirme) bilerek
   kaldırdık; ortalama kullanıcı için seçenek değil, iyi bir varsayılan gerekir.
   Yeni bir seçenek eklemeden önce gerçekten kullanıcıya ait bir karar mı diye sor.
6. [core.test.ts](../tests/core.test.ts): `normalizeLibrary` için bir test ekle
   (geçersiz değer varsayılana dönüyor mu?).
7. macOS ↔ webOS: `models.ts`, `library.ts`, `Settings.tsx` ortak dosyalardır
   (bkz. 13.7).

### 13.3 Tarif: yeni bir Xtream/RPC eylemi eklemek

1. [xtream.ts](../src/core/xtream.ts): `Xtream` sınıfına metot ekle. Kimlikleri
   `id()` ile doğrula, cevabı `object()`/`text()` ile temizle, sonucu
   `models.ts`'de tanımladığın tipe indirge.
2. [models.ts](../src/core/models.ts): eylem adını `Action` birleşim tipine ekle.
3. [preload.ts](../src/platform/mac/preload.ts): adı `actions` dizisine ekle.
   **Unutursan** köprü `METHOD` hatası verir.
4. [session.ts](../src/runtime/session.ts): `dispatch` içine `case` ekle.
5. UI: `platform.call<Tip>('eylem', payload)`, bir `useEffect` içinde ve
   **iptal bayrağıyla** (bkz. 3.4/1).
6. Test: `tests/core.test.ts` içinde sahte `Transport` ile (`{ json: async ()
   => ... }`). E2E için `fixture.ts`'e ilgili `action` yanıtını ekle; yoksa
   fixture `400 unsupported` döner.

### 13.4 Tarif: yeni bir ekran (kenar çubuğu girişi)

1. [App.tsx](../src/ui/App.tsx): `View` tipine yeni değeri ekle, `names` ve
   `views` tablolarına ekle.
2. [Icon.tsx](../src/ui/Icon.tsx): gerekiyorsa `paths` tablosuna yeni SVG yolu
   ekle. Bilinmeyen isim `play` simgesine düşer.
3. Render bölümünde `view === '...'` koşulunu ekle. Yeni ekran kataloğa
   bağlıysa `catalog` koşuluna da ekle.
4. Geri zincirini (bölüm 6.6) yeni ekrana göre gözden geçir.
5. Stilleri `style.css`'e ekle.
6. Ekranın e2e'de bulunması için düğmelere anlamlı `aria-label` ver.

### 13.5 Tarif: yeni bir bileşen

1. `src/ui/` altında dosya aç; props'unu bir tipte açıkça yaz:
   `export function Foo({ a, b }: { a: string; b(): void }) { ... }`.
2. State'i mümkün olan en aşağıda tut. Yalnızca birden çok bileşen ihtiyaç
   duyuyorsa `Workspace`'e taşı.
3. Asenkron iş yapıyorsan effect + iptal bayrağı + cleanup.
4. CSS'i `style.css`'e ekle, sınıf adını bileşen adına göre ver.
5. Metinler Türkçe, `aria-label`'lar Türkçe ve anlamlı olsun.

### 13.6 Tarif: metin değiştirmek

Türkçe metinler bileşenlerin içinde sabit yazılıdır; çeviri katmanı (i18n)
yoktur. Metin değişince `scripts/*.ts` içindeki `getByRole/getByLabel/toContainText`
kullanımlarını `grep` ile bul ve güncelle:

```sh
grep -rn "Tam ekran" src scripts
```

### 13.7 macOS ↔ webOS ortak kod

`src/core`, `src/runtime`, `src/ui` iki depoda **kopya** olarak durur
(monorepo veya paylaşımlı paket yok). Amaç: her deponun tek başına `npm ci`
ve build ile çalışması.

- `npm run shared:check`: iki depoda aynı dosyaların özetini (SHA-256)
  karşılaştırır. **Şu an hata verir** ve bu beklenen bir durumdur: README'de
  yazıldığı gibi Mac oynatma iyileştirmeleri TV'ye taşınmadı.
  `PlaybackStats.tsx` da yalnızca macOS deposundadır.
- `npm run shared:sync`: macOS'taki ortak dosyaları webOS'a **kopyalar**
  (varsayılan hedef `../webOs`). Yıkıcıdır; webOS'taki ayrılmış değişiklikleri
  ezer. Çalıştırmadan önce iki tarafı karşılaştır.
- Ortak klasörlerde bir şeyi değiştirirsen TV tarafında bozulma olup
  olmayacağını düşün. TV, Chromium 68 ve Node 8 uyumu ister; yeni JS
  özelliklerinin çoğu orada çalışmayabilir.

---

## 14. Kod stili ve konvansiyonlar

Kodu okurken şaşırtacak, ama tutarlı olan alışkanlıklar:

- **Yoğun satırlar.** Bir satırda birden çok deyim, tek satırda 5–10 `useState`
  görürsün. Prettier yok. Okurken editörde kelime kaydırmayı aç
  (VS Code: `Alt+Z`) ve Outline paneline bak. Bir fonksiyonu anlamak zorsa
  bana "şunu satır satır aç" demen yeterli.
- **Çoklu `useState`:** `const [a, setA] = useState(...), [b, setB] = useState(...);`
  tek `const` içinde virgülle.
- **Diller:** Arayüz metinleri ve hata mesajları Türkçe; kod, tip ve
  değişken adları İngilizce; kod içi yorumların çoğu İngilizce; belgeler Türkçe.
- **Yorumlar "neden"i anlatır**, "ne"yi değil; çoğu bir ölçüm veya sağlayıcı
  davranışına dayanır. Yorumu silmeden önce düşün. Ayrıntısı VALIDATION.md'de.
- **Sınıf ve fonksiyon dağılımı:** `core`/`runtime`/`platform` tarafı sınıflı
  (`Xtream`, `Session`, `MediaGateway`, `MacVault`), `ui` tarafı yalnızca
  fonksiyon bileşenleridir.
- **`void promise`:** Sonucu beklenmeyen Promise'in başına `void` yazılır
  (bilerek "unutmadım, beklemiyorum" demek).
- **Boş `catch {}`** yalnızca "zaten kapanmış olabilir" gibi zararsız yerlerde
  görülür ve çoğunlukla yorumla açıklanır.
- **Dış veri = güvensiz.** Sunucudan gelen her alan `text()`/`object()`/`id()`
  ile filtrelenir. Uzunluk sınırı da vardır (`text(x, 250)`).
- **Sabitler yorumla birlikte.** Sihirli sayıların (10 sn, 8 MB, 2 MB, 15 sn...)
  çoğu ölçümden gelir; değiştirmeden önce VALIDATION.md'de nedenini ara.
- **İsimlendirme mirası:** `kiyi` öneki eski ürün adından (bkz. bölüm 15).

---

## 15. Bilinen pürüzler ve dikkat edilecekler

Kodu okurken tespit ettiklerim. Hiçbirini değiştirmedim.

1. **İsim mirası.** Uygulamanın eski adı "Kıyı Player"dı. Bu yüzden `kiyi://`
   protokolü, `kiyi:call` IPC kanalı, `window.kiyi`, `KIYI_TEST_*` ortam
   değişkenleri ve paket kimliği `com.kiyi.player.mac` hâlâ eski adı taşır.
   **Yeniden adlandırma:** paket kimliği ve veri klasörü kullanıcının Anahtar
   Zinciri erişimini ve kayıtlı hesabını etkiler (README de bunu belirtiyor).
   Toplu yeniden adlandırmadan kaçın.
2. **Çözüldü: metin/ölçüm uyuşmazlığı.** Eskiden "Tampon" açıklaması "yirmi
   saniyelik görüntü" diyordu, kod 10 sn kullanıyordu. Oynatma ayarları
   kaldırıldığı için o metin de gitti.
3. **`useRemote` ([navigation.ts](../src/ui/navigation.ts)) macOS'ta hiçbir yerden
   import edilmiyor.** TV sürümünün yön tuşu gezinmesi. Ortak klasörde
   durduğu için görünüyor. Silme.
4. **`matches()` ([library.ts](../src/core/library.ts)) yalnızca testte kullanılıyor.**
   `App.tsx` aynı mantığı satır içinde tekrar yazıyor.
5. **TV'ye özgü dallar** (`platform.type === 'tv'`, 461/413/415/417/412/19 tuş
   kodları) macOS'ta çalışmaz. Ortak kod olduğu için burada durur.
6. **Oynatıcıda artık ulaşılmayan kod yolları var.** `adapter.ts` içindeki
   mpegts.js dalı, canlıda yerel HLS dalı ve `buffer: 'normal'` davranışı
   `Session` tarafından üretilmiyor; yalnızca `Playback` sözleşmesi olarak
   duruyor. Silmek istersen `mpegts.js` bağımlılığı da gider. Depoda commit
   olmadığı için silmeden önce bir commit al.
7. **`shared:check` şu an başarısız** (bölüm 13.7). Bu bir hata değil, bilinen
   durum.
8. **Otomatik biçimlendirme ve lint yok.** Tek koruma tip denetimi ve testler.
9. **Hot reload yok.** Her değişiklik yeniden başlatma ister.
10. **Git geçmişi yok.** Henüz commit bulunmuyor (bkz. 13.1).
11. **E2E testleri GUI ve macOS ister** (gerçek pencere, `hevc_videotoolbox`);
    başsız CI ortamında olduğu gibi çalışmaz.
12. **Sanal liste yok.** Çok büyük bir listeyi tek seferde çizmeye çalışırsan
    (ör. `limit` değerini büyük tutmak) arayüz yavaşlar. Mevcut sayfalama bu
    yüzden var.

---

## 16. Öğrenme planı

### 16.1 Önerilen okuma sırası

Sırayla oku; her adımda bir önceki adımın "istemcisi" olacaksın:

1. [models.ts](../src/core/models.ts): tüm sözlük burada.
2. [errors.ts](../src/core/errors.ts) ve [xtream.ts](../src/core/xtream.ts): Xtream
   API'sini nasıl konuşuyoruz?
3. [session.ts](../src/runtime/session.ts): tüm eylemler burada dağıtılıyor.
   Bunu okuduktan sonra backend'i **tamamen** anlamış olursun.
4. [main.ts](../src/platform/mac/main.ts) → [preload.ts](../src/platform/mac/preload.ts)
   → [adapter.ts](../src/platform/mac/adapter.ts) (yalnızca `call`): köprü.
5. [main.tsx](../src/main.tsx) → [Login.tsx](../src/ui/Login.tsx): ilk React
   ekranı. Küçük ve `useState` / `useEffect` / form içeriyor.
6. [App.tsx](../src/ui/App.tsx): `Workspace`. Uzun; bölüm 7'deki tabloyla birlikte oku.
7. [Details.tsx](../src/ui/Details.tsx), [Guide.tsx](../src/ui/Guide.tsx),
   [Modal.tsx](../src/ui/Modal.tsx): küçük bileşenler.
8. [Player.tsx](../src/ui/Player.tsx), sonra [adapter.ts](../src/platform/mac/adapter.ts)
   içindeki `attach`, sonra [media.ts](../src/platform/mac/media.ts): oynatma.
9. [core.test.ts](../tests/core.test.ts), [fixture.ts](../scripts/fixture.ts),
   [e2e.ts](../scripts/e2e.ts): testler.
10. [VALIDATION.md](VALIDATION.md): "neden böyle" hikâyesi.

### 16.2 Alıştırmalar (kolaydan zora)

1. **Metni düzelt.** Ayarlar sayfasındaki "Cihaz & hesap" kartında "HLS/TS
   oynatıcı" yazıyor; canlı yayın artık hls.js ile açılıyor. Metni güncelle.
   Böylece `typecheck → build → start → gözle bak → e2e` döngüsünü ısıtırsın.
2. **Bir sayı göster.** Kenar çubuğunda yalnızca "Favoriler" bir sayı rozeti
   (`nav-count`) gösteriyor. Aynı rozeti "Son izlenenler" için de ekle.
3. **Bir ayar ekle.** Bölüm 13.2'deki tarifle "Sayfa başına öğe" ayarını ekle
   (60 / 120 / 240) ve bir birim test yaz.
4. **Bir kısayol ekle.** `Player.tsx`'te `↑`/`↓` ile ses ayarını değiştir.
   Klavye işleyicisini ve `onPreference` akışını öğrenirsin.
5. **Yeni bir RPC.** Bölüm 13.3'ü izleyerek küçük bir eylem ekle (örn. hesap
   bilgisini yeniden sorgulayıp tazeleyen bir `account` eylemi) ve
   `Session`, `preload`, `models` ile testini uçtan uca bağla.

### 16.3 Okunacak kaynaklar

- React resmi dokümantasyonu: <https://react.dev/learn>. Özellikle
  "Managing State" ve "Synchronizing with Effects" bölümleri.
- TypeScript El Kitabı: <https://www.typescriptlang.org/docs/handbook/intro.html>
- MDN, `HTMLMediaElement`: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement>
- Electron süreç modeli: <https://www.electronjs.org/docs/latest/tutorial/process-model>
- Electron güvenlik listesi: <https://www.electronjs.org/docs/latest/tutorial/security>
- Playwright: <https://playwright.dev/docs/intro>
- hls.js: <https://github.com/video-dev/hls.js>

---

## 17. Sözlük

| Terim | Anlamı |
| --- | --- |
| **DOM** | Sayfanın nesne ağacı; JS bunu okuyup değiştirir |
| **Component (bileşen)** | Props alıp JSX döndüren fonksiyon; arayüzün yeniden kullanılabilir parçası |
| **Props** | Bileşene dışarıdan verilen girdi (fonksiyon argümanı gibi) |
| **State** | Bileşenin hatırladığı, değişince ekranı yenileyen veri |
| **Render** | Bileşen fonksiyonunun çalışıp yeni arayüz tarifi üretmesi |
| **Hook** | `use...` ile başlayan React fonksiyonları (`useState`, `useEffect`...) |
| **Effect** | Render sonrası çalışan yan etki (ağ, zamanlayıcı, dinleyici) |
| **Ref** | Render tetiklemeyen değişken kutusu veya DOM elementi tutamağı |
| **JSX** | JS içinde HTML benzeri yazım |
| **Bundle / bundler** | Birçok dosyayı tek dosyada birleştirme / bunu yapan araç (esbuild) |
| **Main süreç** | Electron'un Node.js tarafı; "backend" |
| **Renderer süreç** | Electron'un Chromium tarafı; "frontend" |
| **Preload** | Renderer'a güvenli bir köprü sunan ara betik |
| **IPC** | Süreçler arası mesajlaşma (`ipcRenderer.invoke` ↔ `ipcMain.handle`) |
| **CSP** | Content Security Policy: sayfanın nereden ne yükleyebileceğini kısıtlayan kural |
| **Sandbox** | Sürecin sistem kaynaklarına erişimini kısıtlayan yalıtım |
| **Xtream** | IPTV sağlayıcılarının kullandığı HTTP API biçimi |
| **VOD** | Video on demand: film ve dizi bölümleri (dosya tabanlı) |
| **EPG** | Program rehberi (kanalda ne zaman ne var) |
| **HLS / `.m3u8`** | Videoyu küçük parçalara bölen akış biçimi ve parça listesi dosyası |
| **MPEG-TS (`.ts`)** | Sürekli akan ham video biçimi |
| **MSE** | Media Source Extensions: JS'in videoya parça parça veri vermesini sağlayan tarayıcı API'si |
| **Codec** | Video/ses sıkıştırma biçimi (H.264, HEVC, AAC, AC-3...) |
| **Tampon (buffer)** | Oynatmadan önce indirilmiş görüntü miktarı |
| **Stall / kesinti** | Tampon boşalıp oynatmanın durması |
| **Debounce** | Ard arda gelen olaylarda yalnızca sonuncuyu, bir bekleme sonrası işleme |
| **Yarış durumu** | İki asenkron işin sırasının sonucu bozması; burada iptal bayrağı/revizyon sayacıyla çözülür |
| **Jeton (token)** | Bu repoda `kiyi://media/` altındaki rastgele, opak medya kimliği |
| **Fixture** | Testler için üretilen sahte sunucu ve veri |
| **Ad hoc imza** | Geliştirici sertifikası olmadan atılan yerel kod imzası |
| **a11y / ARIA** | Erişilebilirlik / erişilebilirlik öznitelikleri (`aria-label`, `role`) |
