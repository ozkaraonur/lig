# Tehdit modeli

> Sahibi: Onur. Aşağıdaki liste başlangıç taslağıdır; STRIDE ile genişletilip her tehdide karşı kontrol ve test eklenecek.

## Kapsam ve güven sınırları

1. **Müşteri platformu → Lig API:** oyuncu token'ı, fiyat akışı, gerçek işlem webhook'u
2. **Oyuncu tarayıcısı (WebView) → Lig API:** oturum çerezi ile REST istekleri
3. **Yönetici tarayıcısı → Lig API:** yönetim paneli
4. **Lig API → PostgreSQL / Redis / LLM API**

## Varlıklar

- Tenant verisinin ayrılığı (bir platform diğerinin verisini görmemeli)
- Sıralamanın bütünlüğü (hile ile üst sıraya çıkılamamalı)
- Platformun imza anahtarı ve yönetici hesapları
- Oyuncu takma kimlikleri ve işlem geçmişi (KVKK)

## İlk tehdit listesi

| #   | STRIDE                 | Tehdit                                                                | Planlanan kontrol                                                                                                                                                               | Durum                                  |
| --- | ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| T1  | Spoofing               | Sahte ya da çalınmış oyuncu token'ı ile başka oyuncu olarak giriş     | Sadece RS256; `iss` ile platform bulunur ve yalnız onun anahtarıyla doğrulanır; `aud`, `exp`, `iat` kontrolü; ömür ≤ 5 dk; `jti` tek kullanım (Redis); genel hata mesajı        | Faz 1 ✓                                |
| T2  | Tampering              | Eski fiyattan emir vererek kesin kazanç (fiyat arbitrajı)             | Fiyat yaşı ≤ 5 sn, fiyat istemciden alınmaz, sunucu tarafında okunur                                                                                                            | Faz 1 ✓                                |
| T3  | Tampering              | Aynı emri paralel gönderip bakiyeyi eksiye düşürme (race condition)   | Tek transaction, satır kilidi, `cash >= 0` CHECK kısıtı, idempotency key                                                                                                        | Faz 1 ✓                                |
| T4  | Information disclosure | Tenant A'nın yöneticisi tenant B'nin verisini görür (IDOR)            | Her sorguda tenant filtresi, yetki testleri, Faz 4'te PostgreSQL RLS                                                                                                            | Oyuncu ve yönetici uçları ✓, RLS Faz 4 |
| T5  | Spoofing               | Sahte webhook ile dönüşüm metriğini şişirme                           | HMAC imzası, zaman damgası penceresi, `external_event_id` benzersizliği                                                                                                         | Faz 1 ✓                                |
| T6  | Elevation of privilege | Yönetici hesabının ele geçirilmesi                                    | argon2id, zorunlu TOTP MFA, ayrı ve kısa ömürlü oturum, IP/hesap/kod deneme sınırları, rol her istekte veritabanından, JSON dışı gövde reddi (login CSRF)                       | Giriş ✓, yönetici yönetimi Faz 2       |
| T7  | Repudiation            | Lig ayarının kim tarafından değiştirildiğinin inkârı                  | Yalnızca eklenebilir denetim tablosu (tetikleyici) ve platform başına SHA-256 özet zinciri, değişiklikle aynı transaction (K-019)                                               | Ekip ve giriş olayları ✓, lig Faz 2    |
| T8  | Tampering              | Prompt injection ile AI koçun al/sat önerisi vermesi                  | Çıktı filtresi, sistem talimatı, yanıt kaydı, kötü niyetli girdi test seti                                                                                                      | Faz 3                                  |
| T9  | Denial of service      | Emir ve sıralama uçlarına yoğun istek                                 | Oyuncu ve tenant başına rate limit, gövde boyutu sınırı (64 KB)                                                                                                                 | Oyuncu uçları ✓, tenant bazlı Faz 4    |
| T10 | Information disclosure | Secret'ların repoya, loga ya da veritabanı yedeğiyle sızması          | `.gitignore`, CI'da gitleaks, logda secret yazmama kuralı, env doğrulaması; webhook anahtarı ve MFA secret'ı satıra bağlı AES-256-GCM ile şifreli (K-015)                       | Faz 0 ✓, şifreleme Faz 2 ✓             |
| T11 | Tampering / SSRF       | Fiyat akışı ile sahte fiyat ya da API'yi iç ağa istek atmaya yöneltme | Fiyat adresi yalnızca kurulumda girilir, üretimde sadece https, yönlendirme takip edilmez, 2 sn zaman aşımı, 256 KB sınırı; her fiyat ayrı doğrulanır, eski fiyat yeniyi ezemez | Faz 1 ✓                                |

## T1 uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/auth/player-token.verifier.ts`. **Testler:** `player-token.verifier.test.ts` (19 test), `auth.e2e.test.ts` (10 test).

| Saldırı                                                              | Sonuç                             | Test |
| -------------------------------------------------------------------- | --------------------------------- | ---- |
| `alg: none`                                                          | 401, imzaya bakılmadan reddedilir | ✓    |
| HS256 ile açık anahtarı secret olarak kullanma (anahtar karışıklığı) | 401                               | ✓    |
| İmzadan sonra payload değiştirme                                     | 401                               | ✓    |
| B platformunun anahtarıyla A platformu adına token                   | 401                               | ✓    |
| Bilinmeyen `iss`                                                     | 401                               | ✓    |
| Başka hizmet için üretilmiş token (`aud`)                            | 401                               | ✓    |
| Süresi dolmuş token (5 sn saat toleransı dışında)                    | 401                               | ✓    |
| Gelecekte üretilmiş token                                            | 401                               | ✓    |
| Ömrü 5 dakikadan uzun token                                          | 401                               | ✓    |
| `jti` olmayan token                                                  | 401                               | ✓    |
| Aynı token'ı ikinci kez kullanma                                     | 401                               | ✓    |
| `sub` ya da `name` içinde HTML / geçersiz karakter                   | 401                               | ✓    |
| Dakikada 20'den fazla giriş denemesi (IP başına)                     | 429 + `Retry-After`               | ✓    |
| Sahte oturum çerezi                                                  | 401                               | ✓    |
| Çıkıştan sonra eski çerezle istek                                    | 401                               | ✓    |

**Oturum:** Rastgele 256 bit token, HttpOnly + Secure + SameSite=Strict çerezde. Redis'te token'ın kendisi değil SHA-256 özeti tutulur. Süre 8 saat. Yanıtlarda `Cache-Control: no-store`.

**Loglar:** Reddedilen token'ın sebebi loglanır (`replayed`, `unsupported_alg` gibi), token'ın kendisi asla.

**Bilinen açık konular (Onur'un incelemesi bekleniyor):**

- Token, platformdan web uygulamasına URL fragment'ı (`#token=`) ile geçiyor. Fragment sunucuya ve loglara gitmez, sayfa açılır açılmaz adres çubuğundan silinir; ama tarayıcı eklentileri ve sayfadaki JavaScript görebilir. Tek kullanım ve 5 dakika ömür bu riski sınırlıyor. Alternatif: platformun token'ı POST ile göndermesi.
- `SameSite=Strict` çerezin iOS/Android WebView'larda davranışı gerçek cihazda test edilmeli.
- Giriş sınırı IP başına. Aynı NAT arkasındaki çok sayıda kullanıcı (mobil operatör) etkilenebilir; üretimde tenant + IP bazlı olmalı.
- `trustProxy` kapalı; üretimde yük dengeleyici arkasında gerçek istemci IP'si için ayarlanmalı.

## Fiyat akışı ve ligler: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/prices/`, `apps/api/src/leagues/`. **Testler:** birim ve uç testleri + `*.int.test.ts` (gerçek PostgreSQL ve Redis).

| Saldırı ya da hata                                           | Sonuç                                                     | Test |
| ------------------------------------------------------------ | --------------------------------------------------------- | ---- |
| Akışta lig varlığı olmayan sembol                            | Saklanmaz                                                 | ✓    |
| Sıfır, negatif, bilimsel gösterimli ya da bozuk fiyat        | O fiyat atlanır, diğerleri saklanır                       | ✓    |
| Gelecek zaman damgalı fiyat (2 sn toleransın dışında)        | Saklanmaz                                                 | ✓    |
| Eski fiyatı tekrar gönderme / geç gelen eski fiyat           | Son fiyat geriye gitmez (Redis içinde tek adımda kontrol) | ✓    |
| Akış kesilirse                                               | 5 sn sonra fiyat "bayat" işaretlenir, tek uyarı logu      | ✓    |
| Akış adresinden iç adrese yönlendirme (169.254.169.254 gibi) | Reddedilir                                                | ✓    |
| `file:`, `gopher:` adresleri, adreste kullanıcı adı/parola   | Reddedilir                                                | ✓    |
| Yavaş ya da çok büyük yanıt                                  | 2 sn / 256 KB'de kesilir                                  | ✓    |
| Başka platformun ligini listeleme, açma ya da katılma        | Listede yok; açma ve katılma 404, "yok" ile aynı yanıt    | ✓    |
| Taslak ya da arkadaş ligine katılma                          | 404                                                       | ✓    |
| Bitmiş lige katılma                                          | 409 `LEAGUE_NOT_ACTIVE`                                   | ✓    |
| Aynı katılma isteğini 20 kez paralel gönderme                | Tek üyelik, tek bakiye                                    | ✓    |
| Katılırken gövdede bakiye gönderme                           | Yok sayılır; bakiye her zaman ligin başlangıç tutarı      | ✓    |
| Yönetici ligi kapattıktan hemen sonra katılma (eski okuma)   | Koşul yazma anında kontrol edilir, reddedilir             | ✓    |
| Adres çubuğundan lig kimliği yerine yol (`../auth/logout`)   | Web tarafında kodlanır; API 400                           | ✓    |

**Bilinen açık konular:**

- Fiyat akışının kimliği şimdilik yalnızca adres ve TLS'e dayanıyor. Gerçek platformla entegrasyonda istek imzası ya da API anahtarı eklenmeli.

## Emir motoru ve portföy: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/orders/`. **Testler:** `orders.e2e.test.ts` (activity diyagramının her dalı), `order-math.test.ts`, `orders.int.test.ts` (gerçek PostgreSQL ve Redis).

| Saldırı ya da hata                                               | Sonuç                                                                 | Test |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | ---- |
| Gövdede fiyat ya da miktar gönderme                              | 400; fiyat her zaman sunucuda Redis'ten okunur                        | ✓    |
| 5 sn'den eski fiyatla emir (fiyat akışı dururken)                | 409 `PRICE_STALE`                                                     | ✓    |
| Aynı anda 20 alım emriyle bakiyeden fazla harcama                | Tam olarak bakiye kadarı gerçekleşir, bakiye 0,00, eksiye düşmez      | ✓    |
| Aynı pozisyonu paralel "tümünü sat" ile iki kez satma            | Tek satış                                                             | ✓    |
| Aynı emri (aynı idempotency anahtarı) 10 kez paralel gönderme    | Tek emir, diğerleri 200 ile aynı sonucu alır                          | ✓    |
| Aynı anahtarla farklı emir                                       | 409 `IDEMPOTENCY_KEY_REUSED`                                          | ✓    |
| Küçük al-sat döngüleriyle yuvarlamadan para üretme               | Yuvarlama hep kasanın lehine; 2.000 rastgele senaryoda bakiye artmadı | ✓    |
| Bakiyeden 1 kuruş fazla alım                                     | 422 `INSUFFICIENT_CASH`                                               | ✓    |
| Elindekinden fazla satış                                         | 422 `NO_POSITION`                                                     | ✓    |
| Ligde olmayan ya da başka platformun varlığıyla işlem            | 422 `ASSET_NOT_IN_LEAGUE`                                             | ✓    |
| Başlamamış, süresi dolmuş ya da kapatılmış ligde işlem           | 409 `LEAGUE_NOT_ACTIVE`                                               | ✓    |
| Üye olmadan ya da başka platformun liginde işlem / portföy görme | 403 `NOT_A_MEMBER` / 404                                              | ✓    |
| Emir kaydı sırasında veritabanı hatası                           | Bakiye ve pozisyon değişikliği geri alınır                            | ✓    |
| Kodda hata olsa bile eksi bakiye ya da sıfır pozisyon            | Veritabanı CHECK kısıtı reddeder                                      | ✓    |
| Dakikada 30'dan fazla emir (oyuncu başına)                       | 429 + `Retry-After`                                                   | ✓    |

**Nasıl:** Emir tek transaction'da işlenir. Önce lig paylaşımlı kilitle (`FOR SHARE`), sonra üyelik özel kilitle (`FOR UPDATE`) okunur; aynı oyuncunun aynı ligdeki emirleri sıraya girer, farklı oyuncular birbirini beklemez. Kilit sırası her yerde aynı (önce lig, sonra üyelik), kilitlenme (deadlock) olmaz. Hesaplar BigInt ile tam sayı kuruş/birim üzerinden yapılır (K-009).

**Bilinen açık konular:**

- Dakikada 30 emir sınırı oyuncu başına. Bir platformun bütün oyuncularının toplam yükü için tenant bazlı sınır Faz 4'te.
- Doğrulama hatası mesajı birleşik şemalarda (al / tutarla sat / tümünü sat) alan adı yerine "body" diyebiliyor. Güvenlik sorunu değil, mesaj iyileştirmesi.

## Sıralama ve lig kapanışı: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/ranking/`. **Testler:** `standings.test.ts`, `ranking.e2e.test.ts`, `ranking.int.test.ts` (gerçek PostgreSQL ve Redis).

| Saldırı ya da hata                                          | Sonuç                                                                | Test |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| Bitişten sonra emir verip final sırayı değiştirmeye çalışma | 409 `LEAGUE_NOT_ACTIVE`, kapanıştan önce de sonra da                 | ✓    |
| Lig kapandıktan sonra fiyat yükselince sırayı değiştirme    | Final sıra, final değer ve portföy ekranı kapanış fiyatlarıyla donar | ✓    |
| Kapanış işini iki kez ya da aynı anda beş kez çalıştırma    | Tek kapanış, XP bir kez                                              | ✓    |
| Kapanış yarıda kalıp tekrar çalışınca XP'yi ikiye katlama   | XP defteri tekil, ikinci çalışmada 0 XP                              | ✓    |
| Hiç işlem yapmadan birinci olup ödül alma                   | Ödül yok                                                             | ✓    |
| Başka platformun sıralamasını görme                         | 404                                                                  | ✓    |
| Sıralama yanıtından oyuncuların iç kimliklerini toplama     | Yanıtta iç kimlik yok, sadece görünen ad                             | ✓    |

**Kabul edilen hile riskleri (K-018):**

- **Çoklu hesap:** Aynı kişi birden fazla hesapla katılıp birini "risk hesabı" olarak kullanabilir. Şimdilik kabul; ödül yalnızca XP. Pilotta platformdan "kimliği doğrulanmış hesap" bilgisi istenir.
- **Son dakikada her şeyi tek varlığa basma:** Kabul, gerçek piyasa riskiyle aynı. Platform isterse ileride varlık başına üst sınır lig ayarı olur (FR-20).
- **Sıralama 2 sn gecikmeli:** Oyuncu kendi portföyünü anlık, sıralamayı en fazla birkaç saniye geriden görür. Güvenlik sorunu değil; final sıra kapanış anında yeniden hesaplanır.

## Webhook ve görevler: uygulama ayrıntısı (Faz 1)

**Kod:** `apps/api/src/webhooks/`, `apps/api/src/quests/`. **Testler:** `webhooks.e2e.test.ts`, `quests.int.test.ts`.

| Saldırı ya da hata                                                                   | Sonuç                                                     | Test |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---- |
| Yanlış anahtarla imzalanmış bildirim                                                 | 401, hiçbir şey yazılmaz                                  | ✓    |
| Başka platformun adına (`x-lig-issuer`) bildirim                                     | 401                                                       | ✓    |
| İmzadan sonra gövdede oyuncu kimliğini değiştirme                                    | 401                                                       | ✓    |
| 5 dakikadan eski ya da ileri tarihli zaman damgası (yakalanan isteği tekrar oynatma) | 401                                                       | ✓    |
| Aynı olay kimliğini tekrar gönderme                                                  | 202 `duplicate: true`, olay ve görev bir kez sayılır      | ✓    |
| İmzalı ama bilinmeyen alanlı, bilinmeyen tipte ya da enjeksiyonlu gövde              | 400                                                       | ✓    |
| Gelecek tarihli ya da 7 günden eski olay (`occurredAt`)                              | 400                                                       | ✓    |
| Görev olayını iki kez işleme, iki worker'ın aynı olayı alması                        | İlerleme kaynaktan sayılır, XP görev-dönem başına bir kez | ✓    |
| A platformundaki katılımın B platformunun görevini tamamlaması                       | Sayımlar tenant ile sınırlı, tamamlanmaz                  | ✓    |
| "Gerçek hesabıma geç" adresine `javascript:` yazılması (XSS)                         | Sunucu ve web yalnızca http(s) adresi kabul eder          | ✓    |

**Bilinen açık konular:**

- Webhook ucunda istek sınırı yok. Hatalı imzalı istek yağmuru her seferinde bir tenant sorgusuna yol açar; Faz 4'te platform IP izin listesi ve issuer başına sınır.
- Fastify gövdeyi imza doğrulamasından önce JSON olarak ayrıştırıyor (prototype pollution korumalı `secure-json-parse` ile). İş kuralları ve kayıt yine de imzadan sonra. İstenirse webhook yolu için ham gövde ayrıştırıcısı ayrı tanımlanabilir.
- Oyuncu gerçek işlem görevini tamamlamak için platformda gerçekten işlem yapmalı; bu, platformu "işlem teşviki" açısından regülasyona tabi kılabilir (NFR-06). Görev metni ve ödül türü hukukçuyla netleşmeli.

## Yönetici girişi ve şifreli anahtarlar: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/api/src/admin-auth/`, `apps/api/src/secrets/`. **Testler:** `admin-auth.e2e.test.ts`, `totp.test.ts` (RFC 6238 vektörleri), `password-hasher.test.ts` (libargon2 referans vektörü), `local-secret-cipher.test.ts`, `admin-auth.int.test.ts` ve `secrets.int.test.ts` (gerçek PostgreSQL ve Redis). Ayrıca çalışan sistemde tarayıcı ve curl ile denendi.

| Saldırı ya da hata                                                       | Sonuç                                                                | Test |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---- |
| Kayıtlı olmayan e-postayla ve yanlış parolayla giriş                     | Aynı 401 ve benzer süre (hesap keşfi yok)                            | ✓    |
| Tek IP'den çok hesaba parola denemesi                                    | 15 dk'da 20 denemeden sonra 429                                      | ✓    |
| Tek hesaba parola denemesi                                               | 15 dk'da 10 denemeden sonra 429, doğru parola da beklemek zorunda    | ✓    |
| Parolayı bilip MFA kodunu tahmin etme                                    | Giriş adımı başına 3, yönetici başına 15 dk'da 5 deneme              | ✓    |
| Omuz üstünden görülen kodu tekrar kullanma                               | 401; kullanılan zaman adımı veritabanında harcanır                   | ✓    |
| Aynı geçerli kodu 4 ayrı giriş adımından aynı anda gönderme              | Yalnızca biri oturum açar                                            | ✓    |
| Parola adımından sonra MFA'yı atlayıp panele girme                       | Giriş adımı çerezi oturum yerine geçmez, 401                         | ✓    |
| MFA kurulu hesapta kurulumu yeniden başlatıp secret'ı değiştirme         | 403                                                                  | ✓    |
| Giriş adımı token'ını oturum olarak kullanma (oturum sabitleme)          | Doğru koddan sonra yeni token üretilir, eskisi silinir               | ✓    |
| Yönetici çerezini oyuncu uçlarında, oyuncu çerezini yönetici uçlarında   | 401, iki yönde de                                                    | ✓    |
| Rolü düşürülen, silinen ya da MFA'sı sıfırlanan yöneticinin açık oturumu | Bir sonraki istekte 403 / 401                                        | ✓    |
| 8 saati geçen oturum                                                     | 401, oturum silinir                                                  | ✓    |
| Başka sitedeki HTML formundan giriş (login CSRF)                         | 415; gövdeli her istek JSON olmak zorunda                            | ✓    |
| Gövdede `role` ya da `__proto__` gibi fazladan alan                      | 400                                                                  | ✓    |
| Veritabanı yedeğinden webhook anahtarı ya da MFA secret'ı okuma          | Şifreli; anahtar veritabanında değil                                 | ✓    |
| A platformunun şifreli anahtarını B platformunun satırına kopyalama      | Çözülemez, webhook genel 401 ile reddedilir                          | ✓    |
| Şifreli metnin herhangi bir parçasını değiştirme                         | Çözülemez                                                            | ✓    |
| Anahtar değişiminden sonra eski kayıtlar                                 | Eski anahtarla okunur, `secrets:rotate` yeni anahtarla yeniden yazar | ✓    |
| Üretimde `SECRET_KEYS` olmadan başlatma                                  | Uygulama başlamaz, hata mesajında anahtar değeri yok                 | ✓    |
| Bozuk ya da dev bellek isteyen parola hash'i kaydı                       | Doğrulanmaz, pahalı hesap yapılmaz                                   | ✓    |
| QR kodun dış servise gönderilmesi                                        | QR tarayıcıda çizilir, secret sayfadan dışarı çıkmaz                 | Kod  |

**Bilinen açık konular:**

- Hesap başına deneme sınırı, saldırganın bir yöneticiyi 15 dk girişten alıkoymasına izin veriyor. Hesap kalıcı kilitlenmediği için kabul edildi.
- Kurtarma kodu yok. Telefonunu kaybeden yönetici için MFA'yı başka bir sahip panelden sıfırlar; tek sahipse komut satırı (`admin:reset-mfa`).
- Ana anahtar pilot öncesinde uygulama ortam değişkeninde (K-015). Sunucuyu ele geçiren anahtara da ulaşır. Faz 3.5: OpenBao.
- Oturum çerezi `Secure`. Yerel geliştirmede tarayıcılar `localhost`'u istisna tutuyor; yerel ağdaki başka bir cihazdan `http://` ile açılırsa giriş çalışmaz.

## Denetim kaydı ve ekip yönetimi: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/api/src/audit/`, `apps/api/src/admin-team/`. **Testler:** `audit.int.test.ts`, `admin-team.int.test.ts` (HTTP üzerinden, gerçek PostgreSQL ve Redis), `admin-auth.e2e.test.ts`. Ayrıca iki ayrı tarayıcı profiliyle davet, rol değişimi, parola değişimi ve kaldırma akışı denendi.

| Saldırı ya da hata                                                               | Sonuç                                              | Test |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ---- |
| Uygulama üzerinden denetim kaydını değiştirme, silme, TRUNCATE                   | Veritabanı reddeder                                | ✓    |
| Tetikleyiciyi kapatıp bir kaydın alanını ya da ayrıntısını değiştirme            | Doğrulama o kaydı bozuk gösterir                   | ✓    |
| Tetikleyiciyi kapatıp aradan kayıt silme                                         | Doğrulama bir sonraki kaydı bozuk gösterir         | ✓    |
| Değiştirilen kaydın özetini de yeniden hesaplama                                 | Sonraki kayıt eski özete bağlı, zincir kırılır     | ✓    |
| Aynı platformda aynı anda 30 kayıt                                               | Zincir sağlam, iki kayıt aynı "önceki özet"i almaz | ✓    |
| Başka platformun denetim kaydını görme                                           | Liste yalnızca kendi zinciri                       | ✓    |
| Düzenleyici ya da izleyicinin ekip ve denetim uçlarına erişimi                   | 403                                                | ✓    |
| Başka platformun yöneticisinin rolünü değiştirme, MFA'sını sıfırlama, silme      | 404 ("yok" ile aynı), değişiklik yok               | ✓    |
| Kendi rolünü değiştirme, kendini kaldırma, kendi MFA'sını sıfırlama              | 403                                                | ✓    |
| İki sahibin aynı anda birbirini düşürmesi (10 platformda aynı anda)              | Her platformda tam bir sahip kalır                 | ✓    |
| Davet linkini ikinci kez kullanma, aynı linki 5 sekmeden aynı anda kabul etme    | Tek hesap açılır, diğerleri 404                    | ✓    |
| Süresi dolmuş, iptal edilmiş ya da yenisiyle değiştirilmiş davet                 | 404, hepsi aynı yanıt                              | ✓    |
| Davet token'ı tahmini                                                            | 256 bit; IP başına 15 dk'da 30 denemeden sonra 429 | ✓    |
| Başka platformda yönetici olan e-postayla daveti kabul edip o hesabı ele geçirme | 409, mevcut hesap değişmez                         | ✓    |
| Davet token'ının veritabanında ya da denetim kaydında görünmesi                  | Yalnızca özeti saklanır, kayıtta yok               | ✓    |
| Parolası çalınmış yöneticinin açık oturumlarının devam etmesi                    | Parola değişince bütün oturumlar düşer             | ✓    |
| MFA'sı sıfırlanan ya da kaldırılan yöneticinin açık oturumu                      | Bir sonraki istekte 401                            | ✓    |
| Mevcut parolayı bilmeden parola değiştirme                                       | 401, yönetici başına 15 dk'da 5 deneme             | ✓    |
| Başka sitedeki formdan daveti kabul ettirme                                      | 415                                                | ✓    |

**Bilinen açık konular:**

- Veritabanı sahibi tetikleyiciyi kapatıp zincirin sonundan kayıt silebilir; bu zincirden anlaşılmaz. Faz 4: son özetin dışarı yazılması, uygulamanın ayrı ve kısıtlı veritabanı rolüyle çalışması (K-019).
- Denetim kaydında yöneticilerin IP adresi var (KVKK açısından kişisel veri). Saklama süresi ve imha kuralı pilot öncesinde hukukçuyla belirlenmeli; kayıt değiştirilemez olduğu için imha ancak zincir bazında arşivleme ile yapılabilir.
- Davet linki sahibin kendi kanalıyla iletiliyor (e-posta, mesaj). Link ele geçirilirse 72 saat içinde başkası hesabı açabilir; sahip ekip listesinde yeni hesabı görür ve kaldırabilir. Pilotta e-postayla gönderim.

## Lig yönetimi ve uyum ayarları: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/api/src/admin-leagues/`, `apps/api/src/leagues/`. **Testler:** `admin-leagues.int.test.ts` (HTTP üzerinden, gerçek PostgreSQL ve Redis), `drizzle-league.repository.int.test.ts`, `leagues.e2e.test.ts`, `packages/shared/src/admin-leagues.test.ts`. Ayrıca tarayıcıda lig oluşturma, kontenjan dolunca katılamama, düzenleme ve uyum ayarı akışı denendi.

| Saldırı ya da hata                                            | Sonuç                                                | Test |
| ------------------------------------------------------------- | ---------------------------------------------------- | ---- |
| İzleyicinin lig oluşturması, düzenlemesi, silmesi             | 403                                                  | ✓    |
| Başka platformun ligini görme, düzenleme, silme               | 404 ("yok" ile aynı)                                 | ✓    |
| Başka platformun varlığıyla lig kurma                         | 400                                                  | ✓    |
| Lige nakit ödül alanı ya da kapanış tarihi gönderme           | 400, katı şema                                       | ✓    |
| Katılımcısı olan ligin başlangıç bakiyesini değiştirme        | 409 `LEAGUE_LOCKED`                                  | ✓    |
| Süren ligin başlangıcını, tipini değiştirme, varlık çıkarma   | 409 `LEAGUE_LOCKED`                                  | ✓    |
| Süren ligin bitişini şimdiye çekip anında kapatma             | 400                                                  | ✓    |
| Kapanmış ligde herhangi bir değişiklik                        | 409                                                  | ✓    |
| Kontenjanı mevcut katılımcı sayısının altına indirme          | 400                                                  | ✓    |
| 10 kişilik lige aynı anda 30 katılım                          | Tam 10 üyelik                                        | ✓    |
| Bakiye değişirken aynı anda katılım (12 tur)                  | Her üyenin bakiyesi ligin son bakiyesiyle aynı       | ✓    |
| Geç katılımı kapalı süren lige katılma                        | 409                                                  | ✓    |
| İzleyicinin uyum ayarını değiştirmesi                         | 403                                                  | ✓    |
| Kilitli uyum ayarını (nakit ödül, kişisel öneri) API ile açma | 400, yazma ucu yok                                   | ✓    |
| Buton kapalıyken oyuncunun platform adresini alması           | `/auth/me` adresi göndermez                          | ✓    |
| Görev kapalıyken "gerçek işlem yap" görevinden XP             | Görev listelenmez ve değerlendirilmez                | ✓    |
| Lig ve uyum değişikliklerinin inkârı                          | Eski ve yeni değerle denetim kaydında, zincir sağlam | ✓    |

**Bilinen açık konular:**

- Katılım koşulu olarak "kimliği doğrulanmış hesap" yok; platform token'ına bu bilgi eklenince gelecek (K-018, K-021).
- Uyum ayarlarında sahibin kararı tek kişilik. Pilotta "iki onay" (dört göz) istenebilir.

## Görev şablonları ve marka ayarları: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/api/src/admin-settings/`, `apps/web/app/admin/quests/`, `apps/web/app/admin/branding/`, `apps/web/app/branding.tsx`. **Testler:** `admin-settings.int.test.ts` (HTTP üzerinden, gerçek PostgreSQL ve Redis), `packages/shared/src/branding.test.ts`, `quests.test.ts`. Ayrıca tarayıcıda görev ekleme, oyuncu ekranında görme, pasife alma, hedefi tablodan düzenleme, silme ve marka rengini değiştirip oyuncu ekranının değişmesi denendi.

| Saldırı ya da hata                                    | Sonuç                                         | Test |
| ----------------------------------------------------- | --------------------------------------------- | ---- |
| İzleyicinin görev ya da marka değiştirmesi            | 403                                           | ✓    |
| Başka platformun görevini görme, düzenleme, silme     | 404 ("yok" ile aynı)                          | ✓    |
| Göreve nakit ödül alanı ya da serbest başlık gönderme | 400, katı şema (FR-24)                        | ✓    |
| Bilinmeyen şablon, dönem ya da sıfır hedef/XP         | 400; veritabanında da CHECK var               | ✓    |
| Aynı şablon ve dönemden ikinci görev                  | 409                                           | ✓    |
| Aynı görevi 10 eşzamanlı istekle açma                 | Tam 1 görev, 1 denetim kaydı                  | ✓    |
| Şablonu ya da dönemi sonradan değiştirme              | 400, alan şemada yok                          | ✓    |
| XP dağıtmış görevi silme                              | 409, yalnızca pasife alınır; verilen XP kalır | ✓    |
| Pasif görevden XP kazanma                             | Görev listelenmez ve değerlendirilmez         | ✓    |
| Logo adresine `javascript:`, `data:` ya da `http://`  | 400; kayıt elle bozulsa bile oyuncuya gitmez  | ✓    |
| Platform adına HTML ya da kontrol karakteri           | 400                                           | ✓    |
| Okunmaz renk seçimi (koyu zeminde koyu yazı)          | Yazı renkleri renkten hesaplanır, ayarlanamaz | ✓    |
| Görev ve marka değişikliğinin inkârı                  | Eski ve yeni değerle denetim kaydında         | ✓    |

**Bilinen açık konular:**

- Logo adresi platformun sunucusundan çekiliyor: oyuncunun IP'si o sunucuya gider ve adresin arkasındaki görsel sonradan değişebilir. Pilotta logonun kendi depolamamıza yüklenmesi değerlendirilecek (K-024).
- "Gerçek işlem yap" görevinin hukuki değerlendirmesi bekliyor (K-017); platform ayarla kapatabiliyor (K-022).
- Görev sayısı ayrı bir sınırla değil, şablon ve dönem kombinasyonu sayısıyla (Faz 3, 1. adımdan sonra 10) sınırlı. Şablon listesi büyürse oyuncu ekranındaki görev sayısı için ayrı bir üst sınır gerekir.

## Metrikler: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/api/src/metrics/`, `apps/web/app/admin/metrics/`, `apps/web/app/real-account-link.tsx`. **Testler:** `metrics.int.test.ts` (HTTP üzerinden, gerçek PostgreSQL ve Redis), `packages/shared/src/metrics.test.ts`. Tarayıcıda: lige katıl, "Gerçek hesabıma geç"e dokun, panoda sayının ve lig satırının artışını gör.

| Saldırı ya da hata                                          | Sonuç                                            | Test |
| ----------------------------------------------------------- | ------------------------------------------------ | ---- |
| Başka platformun sayılarını görme                           | Her sorgu tenant'a bağlı; sayılar 0              | ✓    |
| Oturumsuz metrik okuma                                      | 401                                              | ✓    |
| Listede olmayan dönem (`days=1`, `days=abc`, fazladan alan) | 400, katı şema                                   | ✓    |
| Oturumsuz tıklama kaydı                                     | 401                                              | ✓    |
| Üye olmadığı ligi tıklamaya iliştirme                       | Tıklama ligsiz kaydedilir, o ligin sayısı artmaz | ✓    |
| Tıklama gövdesine adres ya da başka alan koyma              | 400; adres istemciden hiç alınmaz                | ✓    |
| Tıklama sayısını şişirme                                    | Oyuncu başına dakikada 20 istek, sonrası 429     |      |
| Aynı kullanıcının çok işlemi "çok kullanıcı" gibi görünmesi | Kullanıcı ve olay sayısı ayrı sütun              | ✓    |

**Bilinen açık konular:**

- Tıklama sayısı niyeti değil hareketi ölçer: aynı oyuncu butona tekrar tekrar dokunabilir. Bu yüzden panoda hem dokunuş hem farklı oyuncu sayısı var; pilotta dokunuşun günde bir kez sayılması değerlendirilebilir.
- `real_trade_clicks` davranış verisidir. KVKK açısından takma kimlikle tutuluyor ama saklama süresi belirlenmeli; denetim kaydındaki IP sorusuyla birlikte hukukçuya gidecek.
- Metrikler canlı sorgulanıyor. Çok büyük platformda sorgu maliyeti artar; ölçüm eşiği geçilirse günlük özet tablosuna geçilecek (K-025).

## Pay piyasası kuralları ve ikinci müşteri: uygulama ayrıntısı (Faz 2)

**Kod:** `packages/shared/src/market.ts`, `apps/api/src/prices/`, `apps/api/src/orders/orders.service.ts`, `apps/mock-platform/src/main.ts`. **Testler:** `market.test.ts` (takvim ve limitler), `price-ingest.service.test.ts`, `market-close.service.test.ts`, `market-close.int.test.ts` (gerçek PostgreSQL), `orders.e2e.test.ts`. Tarayıcıda: aracı kurum ekranında açık tema, BIST fiyatları ve sektörler, seans içinde emir, seans kapalıyken uyarı ve kilitli panel.

| Saldırı ya da hata                                                | Sonuç                                                    | Test |
| ----------------------------------------------------------------- | -------------------------------------------------------- | ---- |
| Seans dışında hisse emri (öğle arası, kapanış sonrası, tatil)     | 409 `MARKET_CLOSED`, mesajda bir sonraki açılış          | ✓    |
| Arayüzü atlayıp doğrudan API'ye seans dışı emir                   | Aynı 409; kural sunucuda                                 | ✓    |
| Seans dışında aynı ligdeki kripto varlığa emir                    | Kabul edilir; kural yalnızca hisselere                   | ✓    |
| Platform akışının seans dışında fiyat göndermesi                  | Saklanmaz, son kapanış durur                             | ✓    |
| Akışın günlük %10'dan fazla oynayan fiyat göndermesi              | Tavana/tabana çekilir                                    | ✓    |
| Akışın bozuk fiyatı (0, negatif, metin)                           | Reddedilir; limit hesabı da geçersiz referansı yok sayar | ✓    |
| Öğle arasında dünün kapanışı olarak bugünün fiyatının yazılması   | Yazılmaz; yalnızca o günün kendi kapanışı yazılır        | ✓    |
| Aynı gün için kapanışın ikinci kez yazılması                      | Tarihi eski olmayan satır güncellenmez                   | ✓    |
| Başka platformun sembolüne kapanış yazma                          | 0 satır                                                  | ✓    |
| Kripto varlığa kapanış/limit uygulanması                          | Uygulanmaz                                               | ✓    |
| Takvimin kapsamadığı yıl                                          | Hafta sonu kuralı + `calendarKnown: false`               | ✓    |
| İki müşterinin verisinin karışması (varlık, lig, fiyat, yönetici) | Her sorgu tenant'a bağlı                                 | ✓    |

**Bilinen açık konular:**

- Tatil takvimi kodda ve elle güncellenir. 2027 listesi girilmezse o yıl yalnızca hafta sonları kapalı sayılır; `calendarKnown` bunu bildirir ama kimse bakmazsa fark edilmez. Pilot öncesi: takvimin veri sağlayıcıdan gelmesi ya da yılda bir hatırlatma.
- Yarım gün seansının kapanış saati sabit 13:00 modellendi; Borsa İstanbul duyurusu farklı bir saat verirse liste güncellenmeli.
- Sahte Aracı Kurum'un fiyatları uydurmadır ve gerçek BIST verisi değildir. Gerçek veri lisans gerektirir (Faz 3.5).
- Sunucu saati yanlışsa seans kuralı da yanlış olur. Pilotta NTP ve saat sapması izleme gerekir.

## Gerçek fiyat modu: uygulama ayrıntısı (Faz 2)

**Kod:** `apps/mock-platform/src/real-prices.ts`, `server.ts`, `main.ts`. **Testler:** `real-prices.test.ts`, `server.test.ts` (kaynak enjekte edilir, ağa çıkılmaz). Ayrıca yerel sahte bir borsa ucuyla uçtan uca denendi: fiyat sahte platformdan lig API'sine, oradan oyuncu ekranına akıyor ve değişiyor.

| Saldırı ya da hata                              | Sonuç                                                           | Test |
| ----------------------------------------------- | --------------------------------------------------------------- | ---- |
| Borsa ucunun cevap vermemesi ya da zaman aşımı  | Son fiyat yayınlanır, tazelik uydurulmaz; 5 sn sonra bayat      | ✓    |
| Borsa ucunun hiç cevap vermemiş olması          | Simülasyona düşülür, ekranda "düşüldü" yazar                    | ✓    |
| Yanıtın şemasının değişmesi ya da bozuk gelmesi | Yutulur, son fiyat korunur, hata durumda görünür                | ✓    |
| Yanıtta sıfır, negatif ya da metin fiyat        | O parite atlanır                                                | ✓    |
| Tanımadığımız parite (ör. USDTTRY)              | Yayınlanmaz                                                     | ✓    |
| Borsanın saatinin ileri olması                  | Zaman damgası bizim okuma anımız; "gelecekten fiyat" olmaz      | ✓    |
| Hız sınırını aşma                               | Tek istekte bütün pariteler, 2 sn'de bir; istek üst üste binmez | ✓    |
| Modun yanlışlıkla açık kalması                  | Varsayılan kapalı; açıkken ekranda yazıyor                      | ✓    |

**Bilinen açık konular:**

- Borsanın API kullanım şartları pilot öncesi teyit edilmeli (K-028). Mod varsayılan kapalı.
- Gerçek modda sahte platform dışarıya istek atar. Kapalı ağda çalışan bir demoda mod açılmamalı; açılırsa simülasyona düşer ama ekranda hata görünür.
- Fiyat kaynağının adresi ortam değişkeninden gelir. Bu değişken yalnızca sahte platformdadır, yönetici panelinden değiştirilemez: platform fiyat adresi zaten kurulumda bizim tarafımızdan giriliyor (SSRF, K-002).

## Çeşitlendirme görevi: uygulama ayrıntısı (Faz 3, adım 1)

**Kod:** `apps/api/src/quests/quest-store.ts` (`buy_distinct_sectors` sayımı), `packages/shared/src/quests.ts`, migration `0012_quest_sector_template.sql`. **Testler:** `quests-sector.int.test.ts` (gerçek PostgreSQL), `quests.test.ts` (başlık). Testlerin yakaladığı üç mutasyonla kanıtlandı: alış filtresini, varlığın tenant koşulunu ve XP defterindeki `on conflict` tekilliğini kaldırınca ilgili test kırmızıya döndü.

| Saldırı ya da hata                                   | Sonuç                                         | Test |
| ---------------------------------------------------- | --------------------------------------------- | ---- |
| Aynı sektörden çok sayıda alışla hedefi geçme        | Tek sektör sayılır                            | ✓    |
| Sat, sat, sat ile sektör sayısını şişirme            | Satış sayılmaz                                | ✓    |
| Kripto (sektörsüz) varlıkla hedefi doldurma          | Sayılmaz                                      | ✓    |
| Hafta sınırında (pazar 23:59 / pazartesi 00:00) alış | Yalnızca kendi haftasına yazılır              | ✓    |
| Başka platformun varlığı ya da başka oyuncunun alışı | Sayılmaz (sorgu oyuncu ve tenant'a bağlı, T4) | ✓    |
| Aynı hedefi 8 eşzamanlı değerlendirmeyle çoklama     | XP tam bir kez, tek tamamlanma                | ✓    |
| Bilinmeyen şablon adı                                | 400; veritabanında CHECK kısıtı da var        | ✓    |

**Bilinen açık konular:**

- Üç küçük alışla hedef tamamlanabilir: çeşitlendirme davranışı değil, yüzeysel çeşitlilik ödüllenir. Ödül 150 XP ve yalnızca haftalık; kabul edildi (K-018, K-029).
- Kripto platformunda görev tamamlanamaz. Seed eklemiyor, panel şablonu yine sunuyor.
- Sektör adları serbest metin; farklı yazımlar ayrı sayılır (Faz 3.5'te platform verisiyle normalize edilecek).

## Rozetler, unvanlar ve çerçeveler: uygulama ayrıntısı (Faz 3, adım 2)

**Kod:** `apps/api/src/gamification/` (`badge-store.ts` kazanım sorgusu, `drizzle-profile.ts` seçim ve okuma, `profile.service.ts`, `profile.controller.ts`), `packages/shared/src/gamification.ts` (katalog), `apps/api/src/prices/drizzle-asset-close.repository.ts` (tavan/taban günleri), migration `0013_badges_titles_frames.sql`. **Testler:** `gamification.int.test.ts` (gerçek PostgreSQL), `profile.e2e.test.ts`, `market-close.int.test.ts`, `ranking.e2e.test.ts`, `gamification.test.ts` (katalog). Testlerin yakaladığı mutasyonla kanıtlandı: `player_badges` birincil anahtarını kaldırınca eşzamanlı kazanım testi kırmızıya döndü (3 yerine 36 rozet); çerçeve sahiplik koşulunu, unvan XP eşiğini, seçimdeki tenant koşulunu, rozet sorgusundaki tenant koşulunu, Türkiye günü hesabını (UTC+3), podyum sınırını, arkadaş ligi filtresini ve kapanışta satır kilidini kaldırınca ilgili test kırmızıya döndü.

| Saldırı ya da hata                                                       | Sonuç                                                                                            | Test |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---- |
| Rozet çiftliği: aynı değerlendirmeyi eşzamanlı tekrarlama                | Her rozet bir kez yazılır ve bir kez bildirilir (birincil anahtar + `ON CONFLICT`)               | ✓    |
| Rozet çiftliği: kaynak veriyi silip yeniden kazanma                      | Rozet kalır, `earned_at` değişmez; yeni kayıt oluşmaz                                            | ✓    |
| Rozet çiftliği: çoklu hesap                                              | Kabul edildi (K-018). Ödül yalnızca görünüm, XP ve sıralama vermez                               | -    |
| Rozet çiftliği: iki kişilik arkadaş ligiyle Podyum                       | Arkadaş ligi Lig Bitirici ve Podyum saymaz                                                       | ✓    |
| Hiç emir vermeden ligi birinci bitirip rozet alma                        | Rozetler için ligde en az bir emir gerekir (K-011 ödül kuralıyla aynı)                           | ✓    |
| Başkasının çerçevesini seçme (kazanılmamış çerçeve kimliği gönderme)     | 403; `UPDATE` içindeki `exists (player_badges)` koşulu tutmaz, hiçbir alan yazılmaz              | ✓    |
| Başkasının profilini değiştirme (gövdeye `playerId` koyma)               | 400 (katı şema); oyuncu kimliği yalnızca oturumdan gelir                                         | ✓    |
| Başka platformun oyuncusunun seçimini ya da rozetini değiştirme          | Seçim `WHERE tenant_id` ile sınırlı, rozet sorguları tenant'a bağlı; profil okuma 404            | ✓    |
| Yeterli XP'si olmadan yüksek unvan seçme                                 | 403 (`xp >= eşik` aynı `UPDATE` içinde); sıralamada eşik yeniden doğrulanır                      | ✓    |
| Kısmen sahip olunan isteği kısmen uygulatma (unvan tamam, çerçeve değil) | Hepsi ya da hiçbiri: tek `UPDATE`                                                                | ✓    |
| Kataloğ dışı unvan ya da çerçeve kimliği                                 | 400 (zod); veritabanında CHECK kısıtı da var                                                     | ✓    |
| Veritabanı elle bozulup sahip olunmayan unvan gösterilmesi               | `resolveTitle` eşiği yeniden doğrular, en yüksek kazanılmış unvana düşer                         | ✓    |
| Seçim ucuna istek yağdırma                                               | Oyuncu başına dakikada 20 (T9), aşınca 429                                                       | ✓    |
| Tavan Avcısı: başka gündeki alışı tavan gününe saydırma                  | Gün, Türkiye takvimiyle eşleşir; sınır dakikaları (00:00, 23:59:59) ve komşu günler testli       | ✓    |
| Tavan Avcısı: satışla ya da tabanda kapanan hisseyle kazanma             | Yalnızca alış ve yalnızca `limit_up`                                                             | ✓    |
| Tavan Avcısı: başka platformun tavan gününü kullanma                     | Sorgu hem emrin ligi hem `asset_limit_days` için tenant'a bağlı                                  | ✓    |
| İki süreç aynı seans kapanışını yazıp tavan gününü ve sinyali çoklama    | Varlık satırı `FOR UPDATE`; ikinci süreç güncel tarihi görüp atlar                               | ✓    |
| Tavan sinyalinin satıcılara ya da ertesi günün alıcılarına gitmesi       | Sinyal yalnızca o gün alış yapanlara yazılır (fazla değerlendirme zarar vermez, yine de sınırlı) | ✓    |
| Kapanışta sinyalin kaybolması                                            | Sinyal kapanışla aynı transaction'da (outbox); kapanış olur da sinyal olmaz durumu yok           | ✓    |

**Bilinen açık konular:**

- Tavan Avcısı geriye bakışlıdır: hisse tavana çıktıktan sonra alış yapan da kazanır. Gün içi fiyat serisi olmadan ayırt edilemez (K-031). Proje sahibi karar verecek.
- Podyum için en az üye koşulu yok (K-030). Tek kişilik platform ligi podyum verir.
- Rozet, unvan ve çerçeve adlarının (özellikle "Tavan Avcısı") hukuki okunuşu pilot öncesi sorulacak (K-031).
- Rozet ekranı worker'ın birkaç saniyelik gecikmesiyle güncellenir; profil 10 sn'de bir yenilenir.

## Günlük seri ve XP jokeri: uygulama ayrıntısı (Faz 3, adım 3)

**Kod:** `apps/api/src/gamification/` (`streak-store.ts` etkin günler, ödül, joker etkinleştirme, `streak.service.ts`, `streak.controller.ts`), `packages/shared/src/streak.ts` (seri hesabı), `apps/api/src/quests/quest-evaluator.ts` (joker bonusu), migration `0014_daily_streak_xp_joker.sql`. **Testler:** `streak.int.test.ts` (gerçek PostgreSQL), `streak.test.ts` (seri hesabı). Mutasyonla kanıtlandı: oyuncu satırı kilidini kaldırınca eşzamanlı etkinleştirme testi, etkin joker kontrolünü kaldırınca iki test, Türkiye günü kaymasını (UTC+3) kaldırınca emir günü testi, ziyaret yazımındaki tenant koşulunu kaldırınca tenant testi, bonusun "yeni verildi" koşulunu kaldırınca bonus testi, joker başlangıç koşulunu kaldırınca aralık testi kırmızıya döndü.

| Saldırı ya da hata                                                     | Sonuç                                                                                   | Test |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---- |
| Aynı eşiğin ödülünü eşzamanlı çağrılarla çoklama                       | 12 eşzamanlı çağrıda 25 XP ve tek joker; XP defteri ve `xp_jokers` tekilliği            | ✓    |
| Ziyaret ucuna art arda istek atıp gün sayısını şişirme                 | Günde tek satır (birincil anahtar); ayrıca dakikada 20 istek sınırı (T9)                | ✓    |
| Geçmiş ya da gelecek güne ziyaret yazdırma                             | İstekten gün alınmaz, sunucu saati ve Türkiye takvimi kullanılır                        | ✓    |
| Gün sınırında (21:00 UTC) emir verip günü kaydırma                     | Gün UTC+3'e göre hesaplanır, 00:30 Türkiye emri o günün etkin günüdür                   | ✓    |
| Başka oyuncunun ya da başka tenant'ın günleriyle seri kurma            | Her sorgu oyuncu ve tenant'a bağlı; yanlış tenant ile sorulan oyuncunun serisi 0        | ✓    |
| Başka tenant üzerinden ziyaret yazma ya da joker etkinleştirme         | Ziyaret satırı yazılmaz, etkinleştirme 404                                              | ✓    |
| Eşzamanlı istekle iki jokeri aynı anda etkinleştirme (2 kat üstü etki) | Oyuncu satırı kilitli; yalnızca biri geçer, ikinci 409                                  | ✓    |
| Jokeri etkinken yenisini etkinleştirip süreyi uzatma                   | 409 ("zaten etkin"); süre dolunca ikincisi kullanılabilir                               | ✓    |
| Görev tamamlandıktan sonra joker açıp geriye dönük bonus alma          | Bonus yalnızca yeni verilen görev XP'sine yazılır; önce tamamlanan görev bonus almaz    | ✓    |
| Aynı görev değerlendirmesini tekrarlayıp bonusu çoğaltma               | `joker_bonus` (oyuncu, kaynak) tekil; tekrarda yeni XP olmaz                            | ✓    |
| Süresi dolmuş jokerle bonus alma                                       | Etkin aralık yarı açık: başlangıç dahil, bitiş hariç                                    | ✓    |
| Seriyi bozup yeniden başlatarak aynı eşiği tekrar kazanma              | Yeni başlangıç günü yeni kaynak kimliği demektir; yeni seri gerçekten 7 etkin gün ister | ✓    |
| Çoklu hesap ile her hesapta seri ve joker toplama                      | Kabul edildi (K-018). Kazanç yalnızca küçük XP ve görünüm                               | -    |
| Bot ile her gün tek istekle ziyaret ederek seri tutma                  | Kabul edildi, K-032'de açık konu. Emir günleri gerçek eylemdir, ziyaret kolaydır        | -    |

**Bilinen açık konular:**

- Ziyaret tek istekle yazılabilir; bu yüzden seri bir "sadakat" göstergesi, beceri göstergesi değil. Sıkılaştırma seçeneği K-032'de.
- Joker yalnızca görev XP'sini 2 katlar. Lig sonu XP'si, seri XP'si ve rozetler etkilenmez. Bu bilinçli: portföyü ve sıralamayı etkileyen joker alınmadı (K-017).

## Arkadaş ligi ve davet kodu: uygulama ayrıntısı (Faz 3, adım 4)

**Kod:** `apps/api/src/friends/` (`friends-store.ts` kurma ve koda katılma, `friends.controller.ts`), `packages/shared/src/friends.ts` (kurallar, kod biçimi, şemalar), `apps/api/src/leagues/drizzle-league.repository.ts` (üye görünürlüğü), `ranking/league-close.service.ts` (XP yok), `quests/quest-store.ts` (katılım görevi), migration `0015_friends_leagues_invite_code.sql`. **Testler:** `friends.int.test.ts` (gerçek PostgreSQL ve Redis), `friends.test.ts` (kod ve şema). Mutasyonla kanıtlandı: katılımdaki lig kilidini kaldırınca kontenjan testi, kurmadaki oyuncu kilidini kaldırınca eşzamanlı kurma testi, kapanıştaki arkadaş ligi XP istisnasını kaldırınca kapanış testi, görevdeki arkadaş ligi filtresini kaldırınca görev testi, görünürlükteki üyelik koşulunu kaldırınca görünürlük testi, koda katılmadaki tenant koşulunu kaldırınca 404 testi kırmızıya döndü.

| Saldırı ya da hata                                                 | Sonuç                                                                                      | Test |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---- |
| Kodu deneyerek başkasının ligini bulma                             | ~50 bit kod, oyuncu başına dakikada 10 deneme (429); yanlış kod her zaman aynı 404         | ✓    |
| Başka platformun davet kodunu kullanma                             | Kod yalnızca oyuncunun tenant'ında aranır; yanlış kodla aynı 404                           | ✓    |
| Normal ligin kimliğini kod diye deneme                             | Arama `type = 'friends'` ile sınırlı; aynı 404                                             | ✓    |
| Üye olmadan arkadaş ligini görme (liste, detay, sıralama, kod)     | Yalnızca üyeye görünür, diğerleri için "yok" ile aynı yanıt; kod yalnızca üyeye döner      | ✓    |
| Kimlikle normal katılım ucundan arkadaş ligine girme               | `createMembership` arkadaş ligini reddeder, yalnızca kodla girilir                         | ✓    |
| Kontenjanı (10) eşzamanlı katılımla aşma                           | Lig başına danışma kilidi; 25 eşzamanlı katılımda tam 10 üye                               | ✓    |
| Aynı oyuncunun eşzamanlı katılımıyla çift üyelik (çift bakiye)     | Kilit, mevcut üyelik kontrolü ve `(lig, oyuncu)` tekilliği: tek üyelik                     | ✓    |
| Süresi dolmuş arkadaş ligine katılma                               | 409                                                                                        | ✓    |
| Sınırsız lig kurup sistemi şişirme                                 | Oyuncu başına en fazla 3 etkin lig; oyuncu kilidiyle eşzamanlı 8 istekte 3 lig; 5/dk sınır | ✓    |
| Bakiye, kontenjan, tür ya da varlığı istekle belirleme             | Katı şema 400; değerler kodda sabit; veritabanı CHECK kısıtları                            | ✓    |
| Kurulu ligin kodunu boşaltıp ya da kontenjanı büyütüp kuralı bozma | `leagues_friends_shape` ve `leagues_invite_only_friends` kısıtları                         | ✓    |
| Başka platformun oyuncusu için lig kurma                           | 404; oyuncu ve varlıklar tenant'a bağlı                                                    | ✓    |
| İki hesapla arkadaş ligi kurup kasten kaybederek XP taşıma         | Arkadaş ligi XP vermez; Lig Bitirici ve Podyum saymaz                                      | ✓    |
| Kendi arkadaş ligini kurup "Bir lige katıl" görevi toplama         | Görev arkadaş ligi üyeliğini saymaz                                                        | ✓    |
| Çoklu hesap ile arkadaş ligini doldurma                            | Kabul edildi (K-018). Ödül yok, risk büyümez                                               | -    |
| Kod çakışması                                                      | `ON CONFLICT DO NOTHING` ile yeni kod denenir                                              | ✓    |

**Bilinen açık konular:**

- Üyelikten ayrılma, üye çıkarma ve kurucu devri yok (K-033).
- Kod düz saklanır; veritabanı sızarsa kodlar okunur. Etki yalnızca 10 kişilik kapalı lige girmektir.

## Kademe ligleri: uygulama ayrıntısı (Faz 3, adım 5)

**Kod:** `apps/api/src/tiers/` (`tiers-store.ts` yerleştirme ve görünüm, `tiers.controller.ts`), `packages/shared/src/tiers.ts` (kademeler, hareket hesabı), `apps/api/src/ranking/drizzle-ranking.ts` (`applyTierMovements`), `ranking/league-close.service.ts`, `gamification/badge-store.ts` (Podyum koşulu), migration `0016_tier_leagues.sql`. **Testler:** `tiers.int.test.ts` (gerçek PostgreSQL ve Redis), `tiers.test.ts` (hareket hesabı). Mutasyonla kanıtlandı: yerleştirme kilidini kaldırınca eşzamanlı katılım ve gerçek kapanış testi, kapanıştaki hareket çağrısını kaldırınca gerçek kapanış testi, `WHERE tier = eski` koşulunu kaldırınca eski kapanış testi, emir veren koşulunu kaldırınca iki test, Podyum'daki katılımcı koşulunu kaldırınca rozet testi, görünürlük filtresini ve görev filtresini kaldırınca ilgili testler, gruptaki hafta koşulunu kaldırınca üç test kırmızıya döndü.

| Saldırı ya da hata                                                           | Sonuç                                                                                                     | Test |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---- |
| Eşzamanlı katılımla 50 kişilik sınırı aşma                                   | (platform, kademe, hafta) danışma kilidi; 60 katılımda 50 + 10                                            | ✓    |
| Aynı grup numarasını iki kez açma                                            | Tekil indeks `(platform, kademe, hafta başı, grup)`                                                       | ✓    |
| Aynı hafta ikinci kez katılıp ikinci bakiye alma                             | Mevcut üyelik döner, tek üyelik                                                                           | ✓    |
| Grubu ya da kademeyi istekle seçme                                           | Uç gövde almaz; kademe `players.tier`'dan, grup sunucuda seçilir                                          | ✓    |
| Başka platformun grubuna girme ya da başka platformun oyuncusuyla katılma    | Yerleştirme ve sorgular tenant'a bağlı; başka platform üzerinden katılım 404                              | ✓    |
| Üye olmadan kademe grubunu görme ya da kimlikle normal katılım yoluyla girme | Yalnızca üyeye görünür, normal katılım ucu reddeder                                                       | ✓    |
| Hiç oynamadan yükselme, ya da hiç oynamayanı düşürme                         | Yalnızca emir veren üyeler hareket hesabına girer                                                         | ✓    |
| İki kişiyle küçük grupta yükselme                                            | Gruptaki emir veren sayısı 5'ten azsa hareket yok                                                         | ✓    |
| Eşit sıralarla fazla kişiyi yükseltme                                        | Kotayı aşan eşitlik grubu tümüyle dışarıda kalır                                                          | ✓    |
| Kapanışı iki kez çalıştırıp iki kademe atlama                                | Kapanış lig kilidiyle tek sefer; `tier_history (oyuncu, lig)` tekil; ikinci uygulama 0 hareket            | ✓    |
| Geç kapanan eski haftanın güncel kademeyi ezmesi                             | `UPDATE ... WHERE tier = eski`; uygulanmayan hareketin geçmiş kaydı silinir                               | ✓    |
| Kapanış olup kademe hareketinin yazılmaması (yarım kapanış)                  | Hareket kapanışla aynı transaction'da; biri düşerse ikisi de geri alınır                                  | ✓    |
| Kademe grubunda üç hesapla Podyum rozeti                                     | Podyum için gruptan en az 5 emir veren gerekir                                                            | ✓    |
| Haftalık "Bir lige katıl" görevini kademe katılımıyla tamamlama              | Görev kademe grubu üyeliğini saymaz                                                                       | ✓    |
| Veritabanında bozuk kademe ya da grup (elle)                                 | CHECK: tür ve kademe birlikte, bilinen kademe, kontenjan 2-50                                             | ✓    |
| Çoklu hesapla kademe yükseltme                                               | Kabul edildi (K-018). Büyür ama kazanç yalnızca kademe etiketi; kimliği doğrulanmış hesap bilgisi pilotta | -    |

**Bilinen açık konular:**

- Çoklu hesapla aynı gruba girip hesapları diğerlerinin üstüne taşımak mümkün (K-034).
- Haftalık sıfırlama: her hafta yeni 100.000 TL; kademe, yalnızca etiket olarak haftalar arası taşınır.
- Kademe kuralları kodda sabit, panelden değişmez.
