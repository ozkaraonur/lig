# Lig: çalışma kuralları

B2B white-label sanal lig ve oyunlaştırma modülü (kripto platformları ve aracı kurumlar, müşteri uygulamasında WebView). Bağlam repoda: `docs/ROADMAP.md`, `docs/DECISIONS.md` (K-xxx), `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`. Kararları proje sahibi verir, push'u o yapar.

## Kalıcı kurallar

- `docs/DEFTER.md` proje sahibinin yerel defteri, `.git/info/exclude` içinde. `add`, `commit`, `push` etme, içeriğini başka dosyaya kopyalama.
- `.env` ve `apps/mock-platform/keys*/` commit edilmez. Gerçek sır, anahtar, parola koda ya da teste girmez (CI'da gitleaks var); test parolaları adlandırılmış sabit olur.
- Ödül yalnızca XP ve görünüm. Nakit ya da nakde çevrilebilir ödül yok (NFR-06, FR-24). Kişiye özel al/sat önerisi yok. Uyum kuralları kodda sabit (`LOCKED_COMPLIANCE_SETTINGS`), veritabanı bayrağıyla açılıp kapanmaz (K-022).
- Her sorgu tenant'a bağlı (NFR-03). Başka tenant'ın kaydı 404 döner ("yok" ile aynı yanıt).
- `audit_events` append-only ve zincirli (K-019). Yeni yönetici eylemi için `AUDIT_ACTIONS`'a girdi ve arayüz etiketi ekle; kayıt değişiklikle aynı transaction'da yazılır.
- Yarış koşulu olabilecek her yerde (kontenjan, bakiye, tekil kural, XP tekilliği) veritabanı kısıtı ya da kilit kullan, eşzamanlı test yaz ve testin gerçekten yakaladığını kuralı bozarak (mutasyon) kanıtla.
- K-018 kabul edilen riskler: çoklu hesap, son dakika tek varlık. Yeni özellik bunları büyütüyorsa (arkadaş ligi, kademe yükselmesi) açıkça söyle.
- Dil: kod yorumları, hata mesajları, arayüz ve docs Türkçe. Cümle bağlayıcı olarak em dash kullanma. Kısa ve doğrudan yaz.
- Web (`apps/web`): bu Next.js sürümü bilinenden farklı. Kod yazmadan önce `node_modules/next/dist/docs` içinden ilgili kılavuzu oku (`apps/web/AGENTS.md`).

## Ortam

Windows PowerShell, Node >=24.7 <25, npm 11 (10.9'da arborist hatası var), Docker'da PostgreSQL 17 ve Redis. Komutları PowerShell uyumlu ver. Portlar: web 3000, api 4000, sahte kripto platformu 4100 (koyu tema), sahte aracı kurum 4200 (BIST, açık tema). Yerel yönetici girişleri README'de.

## Komutlar

- `npm run check`: shared'ı derler, sonra format, lint, typecheck, test, build.
- `npm run infra:up`: PostgreSQL ve Redis.
- `npm run db:generate`: şema değişince. Migration adını anlamlı yap ve `meta/_journal.json` tag'ini düzelt. `npm run db:migrate`, `npm run db:seed`.
- `npm run test:int`: `*.int.test.ts`, gerçek PostgreSQL ve Redis. `.env` gerekir.
- `npm run dev`: web, api ve sahte platformlar.

## Test katmanları

Birim ve uç testleri (bellek içi fake'ler), entegrasyon (`*.int.test.ts`), tarayıcı akışı (Playwright yoksa tıklama listesi). Entegrasyon testleri `db:seed` uygulanmış veritabanında da geçmeli: okumalar tenant'a bağlı olsun.

## Bir adım nasıl biter

- Branch `faz3-adimN`, commit mesajı Türkçe: "Faz 3 adım N: ...".
- `npm run check` yeşil. Taze veritabanında `db:generate` diff üretmez, `db:migrate` ve `test:int` yeşil.
- Docs güncel: DECISIONS'a yeni karar (K-029'dan devam), THREAT_MODEL'e "nasıl istismar edilir" tablosu, ROADMAP işaretleri, ARCHITECTURE bölümü.
- Diff'te sır taraması.
- `main`'e `--no-ff` merge. Push yok; proje sahibine "senin yapacakların" listesi ver.
