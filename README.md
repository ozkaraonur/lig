# lig

Kripto platformları ve aracı kurumların uygulamalarına gömdüğü, sanal parayla oynanan lig ve oyunlaştırma modülü.

- Tasarım dosyası (gereksinimler, diyagramlar): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ve Claude'daki "Lig Modülü Tasarım Dosyası"
- Yol haritası: [docs/ROADMAP.md](docs/ROADMAP.md)
- Mimari kararlar: [docs/DECISIONS.md](docs/DECISIONS.md)
- Tehdit modeli: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

## Gerekenler

- **Node.js 24.7 veya üstü** (LTS). `node -v` ile kontrol et; parola hash'i için Node'un yerleşik argon2'si kullanılıyor
- **Docker Desktop**
- **Git**

## İlk kurulum

Repo klasöründe terminali aç (Windows'ta PowerShell) ve sırayla çalıştır:

```powershell
copy .env.example .env      # macOS/Linux: cp .env.example .env
npm install
npm run secrets:new-key     # çıkan SECRET_KEYS=... satırını .env'e ekle
npm run infra:up            # PostgreSQL + Redis (Docker)
npm run db:migrate          # tabloları oluşturur
npm run dev                 # API, web ve sahte platform birlikte çalışır
```

İlk kurulumda, `npm run dev` açıkken **ikinci bir terminalde** sahte platformu müşteri olarak kaydet. Bu komut varlıkları ve örnek ligleri de oluşturur; tekrar çalıştırmak güvenlidir:

```powershell
npm run db:seed
```

Demo için gerçek kripto fiyatı istersen `.env` dosyasına `MOCK_PLATFORM_PRICE_MODE=real` ekleyip `npm run dev`'i yeniden başlat: sahte platform TL paritelerini halka açık bir borsa ucundan okur, kaynak ekranında yazar. Varsayılan sahte fiyattır ve o modda dışarı hiç istek gitmez.

Fiyatlar seed'den sonra en geç 30 saniye içinde akmaya başlar. Sahte platform sayfasındaki **Test araçları** bölümünden fiyat akışını durdurup "bayat fiyat" davranışını deneyebilirsin. `http://localhost:4100/trade` sayfası "gerçek işlem" bildirimi (webhook) gönderir; görevlerden biri buna bağlı.

Çalıştığını kontrol et:

| Servis            | Adres                        |
| ----------------- | ---------------------------- |
| API sağlık        | http://localhost:4000/health |
| Oyuncu ekranı     | http://localhost:3000        |
| Yönetim paneli    | http://localhost:3000/admin  |
| Sahte platform    | http://localhost:4100        |
| Sahte aracı kurum | http://localhost:4200        |

**Yönetim paneli girişi (yalnızca yerel geliştirme):** kripto platformu için `yonetici@sahte-platform.test`, aracı kurum için `yonetici@sahte-araci-kurum.test`; ikisinin de parolası `gelistirme-yonetici-parolasi`. İlk girişte telefondaki doğrulama uygulamasıyla (Google Authenticator, Microsoft Authenticator, Bitwarden) QR kod okutulur. Telefonu değiştirirsen: `npm run admin:reset-mfa -- --email yonetici@sahte-platform.test`.

Durdurmak için terminalde `Ctrl + C`, altyapıyı kapatmak için `npm run infra:down`.

## Arkadaşlarla demo

Birkaç tanıdığın kendi telefonundan ya da bilgisayarından denesin diye uygulamayı geçici olarak internete açar. Herkese açık bir yayın değildir. Bilgisayarın açık ve `npm run demo` çalışıyorken erişilir. Neden bu yapı: K-037.

**Gerekenler:** Cloudflare'e eklenmiş bir alan adı (aşağıda `ALANADI.com`), ücretsiz Cloudflare hesabı, `cloudflared` programı (`winget install Cloudflare.cloudflared`).

**1. Ayrı veritabanı.** Eski geliştirme verisi (bilinen parolalı yöneticiler) internete açılmasın:

```powershell
docker compose exec postgres psql -U lig -d postgres -c "CREATE DATABASE lig_demo"
```

**2. Sırları üret.** Her biri rastgele ve en az 16 karakter olmalı. Çıktıları kimseye göndermeyip yalnızca `.env`'e yaz:

```powershell
npm run secrets:new-key
[Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 }))
```

İlk komut `SECRET_KEYS` için, ikinci komut her sır için (üç kez çalıştır: iki webhook sırrı ve yönetici parolası).

**3. `.env` dosyasını doldur** (`.env.example` içindeki "Arkadaşlarla demo" bloğu):

```
DATABASE_URL=postgres://lig:lig_dev_password@localhost:5432/lig_demo
WEB_ORIGIN=https://lig.ALANADI.com
NEXT_PUBLIC_API_URL=https://lig-api.ALANADI.com
NEXT_PUBLIC_MOCK_PLATFORM_URL=https://lig-platform.ALANADI.com
TRUST_PROXY=127.0.0.1,::1
SECRET_KEYS=...
MOCK_PLATFORM_WEBHOOK_SECRET=...
MOCK_BROKER_WEBHOOK_SECRET=...
SEED_ADMIN_PASSWORD=...
```

`WEB_ORIGIN` yerel olmayan bir adres olunca geliştirme sırlarıyla API, seed ve sahte platform başlamaz.

**4. Tüneli kur** (bir kez):

```powershell
cloudflared tunnel login
cloudflared tunnel create lig-demo
cloudflared tunnel route dns lig-demo lig.ALANADI.com
cloudflared tunnel route dns lig-demo lig-api.ALANADI.com
cloudflared tunnel route dns lig-demo lig-platform.ALANADI.com
cloudflared tunnel route dns lig-demo lig-kurum.ALANADI.com
copy infra\cloudflared\config.example.yml infra\cloudflared\config.yml
```

`config.yml` içindeki `ALANADI`, `TUNEL-KIMLIGI` ve `KULLANICI` değerlerini doldur (`create` komutu kimliği yazar). Dört adres aynı alan adının alt alanı olmalı: çerezler `SameSite=Strict`.

**5. Sahte platformları Cloudflare Access ile koru.** Cloudflare panelinde Zero Trust > Access > Applications > Add > Self-hosted. `lig-platform.ALANADI.com` ve `lig-kurum.ALANADI.com` için, yalnızca arkadaşlarının e-posta adreslerini kabul eden bir politika (One-time PIN) kur. Bunu yapmazsan adresi bulan herkes sahte platformdan oyuncu kimliği alıp oynayabilir. `lig` ve `lig-api` Access arkasına alınmaz.

**6. Çalıştır.** Üç ayrı terminalde:

```powershell
npm run db:migrate
npm run demo                  # web'i derler, API, web ve sahte platformu başlatır
npm run db:seed               # demo açıkken, ikinci terminalde
cloudflared tunnel --config infra\cloudflared\config.yml run lig-demo   # üçüncü terminalde
```

Arkadaşlarına `https://lig-platform.ALANADI.com` (kripto) ve `https://lig-kurum.ALANADI.com` (BIST) adreslerini ver; e-posta koduyla girip bir oyuncu seçerler. Yönetim paneli `https://lig.ALANADI.com/admin`, giriş `SEED_ADMIN_PASSWORD` ile.

Kapatınca erişim de kapanır. Demo veritabanını silmek için `DROP DATABASE lig_demo`.

## Sık kullanılan komutlar

| Komut                                                                         | Ne yapar                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run check`                                                               | Shared paketi derler, sonra format, lint, typecheck, test ve build. PR öncesi çalıştır.  |
| `npm run test`                                                                | Birim ve uç testleri (veritabanı gerekmez)                                               |
| `npm run test:int`                                                            | Gerçek PostgreSQL ve Redis ile entegrasyon testleri (`infra:up` ve `db:migrate` sonrası) |
| `npm run db:generate`                                                         | Şema değiştiyse yeni migration üretir                                                    |
| `npm run db:migrate`                                                          | Migration'ları veritabanına uygular                                                      |
| `npm run format`                                                              | Kodu otomatik formatlar                                                                  |
| `npm run admin:create -- --issuer mock-platform --email e@posta --role owner` | Yönetici hesabı açar, geçici parolayı bir kez yazar                                      |
| `npm run admin:reset-mfa -- --email e@posta`                                  | Yöneticinin MFA'sını sıfırlar, sonraki girişte yeniden kurulur                           |
| `npm run secrets:new-key`                                                     | Şifreleme anahtarı üretir (`SECRET_KEYS`)                                                |
| `npm run audit:verify`                                                        | Denetim kaydı zincirlerini doğrular; bozuk kayıt varsa numarasını yazar (K-019)          |
| `npm run secrets:rotate`                                                      | Anahtar değişiminden sonra şifreli kayıtları yeni anahtarla yeniden yazar (K-015)        |

## Repo yapısı

```
apps/
  api/            NestJS + Fastify. Kurallar, emir motoru, ligler, sıralama, yönetim
  web/            Next.js. Oyuncu ekranları ve yönetim paneli
  mock-platform/  Test ve demo için sahte müşteri platformu
packages/
  shared/         Paylaşılan tipler, hata kodları, zod şemaları
docs/             Mimari, kararlar, yol haritası, tehdit modeli
```
