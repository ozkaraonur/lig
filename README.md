# lig

Kripto platformları ve aracı kurumların uygulamalarına gömdüğü, sanal parayla oynanan lig ve oyunlaştırma modülü.

- Tasarım dosyası (gereksinimler, diyagramlar): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ve Claude'daki "Lig Modülü Tasarım Dosyası"
- Yol haritası: [docs/ROADMAP.md](docs/ROADMAP.md)
- Mimari kararlar: [docs/DECISIONS.md](docs/DECISIONS.md)
- Tehdit modeli: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)

## Gerekenler

- **Node.js 24** (LTS)
- **Docker Desktop**
- **Git**

## İlk kurulum

Repo klasöründe terminali aç (Windows'ta PowerShell) ve sırayla çalıştır:

```powershell
copy .env.example .env      # macOS/Linux: cp .env.example .env
npm install
npm run infra:up            # PostgreSQL + Redis (Docker)
npm run db:migrate          # tabloları oluşturur
npm run dev                 # API, web ve sahte platform birlikte çalışır
```

İlk kurulumda, `npm run dev` açıkken **ikinci bir terminalde** sahte platformu müşteri olarak kaydet. Bu komut varlıkları ve örnek ligleri de oluşturur; tekrar çalıştırmak güvenlidir:

```powershell
npm run db:seed
```

Fiyatlar seed'den sonra en geç 30 saniye içinde akmaya başlar. Sahte platform sayfasındaki **Test araçları** bölümünden fiyat akışını durdurup "bayat fiyat" davranışını deneyebilirsin. `http://localhost:4100/trade` sayfası "gerçek işlem" bildirimi (webhook) gönderir; görevlerden biri buna bağlı.

Çalıştığını kontrol et:

| Servis         | Adres                        |
| -------------- | ---------------------------- |
| API sağlık     | http://localhost:4000/health |
| Oyuncu ekranı  | http://localhost:3000        |
| Yönetim paneli | http://localhost:3000/admin  |
| Sahte platform | http://localhost:4100        |

Durdurmak için terminalde `Ctrl + C`, altyapıyı kapatmak için `npm run infra:down`.

## Sık kullanılan komutlar

| Komut                          | Ne yapar                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run check`                | Format, lint, typecheck, test ve build. PR öncesi çalıştır.                              |
| `npm run test`                 | Birim ve uç testleri (veritabanı gerekmez)                                               |
| `npm run test:int -w @lig/api` | Gerçek PostgreSQL ve Redis ile entegrasyon testleri (`infra:up` ve `db:migrate` sonrası) |
| `npm run db:generate`          | Şema değiştiyse yeni migration üretir                                                    |
| `npm run db:migrate`           | Migration'ları veritabanına uygular                                                      |
| `npm run format`               | Kodu otomatik formatlar                                                                  |

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
