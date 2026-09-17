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

| #   | STRIDE                 | Tehdit                                                                | Planlanan kontrol                                                                                                                                                               | Durum                               |
| --- | ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| T1  | Spoofing               | Sahte ya da çalınmış oyuncu token'ı ile başka oyuncu olarak giriş     | Sadece RS256; `iss` ile platform bulunur ve yalnız onun anahtarıyla doğrulanır; `aud`, `exp`, `iat` kontrolü; ömür ≤ 5 dk; `jti` tek kullanım (Redis); genel hata mesajı        | Faz 1 ✓                             |
| T2  | Tampering              | Eski fiyattan emir vererek kesin kazanç (fiyat arbitrajı)             | Fiyat yaşı ≤ 5 sn, fiyat istemciden alınmaz, sunucu tarafında okunur                                                                                                            | Faz 1 ✓                             |
| T3  | Tampering              | Aynı emri paralel gönderip bakiyeyi eksiye düşürme (race condition)   | Tek transaction, satır kilidi, `cash >= 0` CHECK kısıtı, idempotency key                                                                                                        | Faz 1 ✓                             |
| T4  | Information disclosure | Tenant A'nın yöneticisi tenant B'nin verisini görür (IDOR)            | Her sorguda tenant filtresi, yetki testleri, Faz 4'te PostgreSQL RLS                                                                                                            | Oyuncu lig uçları ✓, Faz 2–4        |
| T5  | Spoofing               | Sahte webhook ile dönüşüm metriğini şişirme                           | HMAC imzası, zaman damgası penceresi, `external_event_id` benzersizliği                                                                                                         | Faz 1 ✓                             |
| T6  | Elevation of privilege | Yönetici hesabının ele geçirilmesi                                    | argon2id, zorunlu TOTP MFA, ayrı ve kısa ömürlü oturum, IP/hesap/kod deneme sınırları, rol her istekte veritabanından, JSON dışı gövde reddi (login CSRF)                       | Giriş ✓, yönetici yönetimi Faz 2    |
| T7  | Repudiation            | Lig ayarının kim tarafından değiştirildiğinin inkârı                  | Değiştirilemez denetim kaydı (NFR-07)                                                                                                                                           | Faz 2                               |
| T8  | Tampering              | Prompt injection ile AI koçun al/sat önerisi vermesi                  | Çıktı filtresi, sistem talimatı, yanıt kaydı, kötü niyetli girdi test seti                                                                                                      | Faz 3                               |
| T9  | Denial of service      | Emir ve sıralama uçlarına yoğun istek                                 | Oyuncu ve tenant başına rate limit, gövde boyutu sınırı (64 KB)                                                                                                                 | Oyuncu uçları ✓, tenant bazlı Faz 4 |
| T10 | Information disclosure | Secret'ların repoya, loga ya da veritabanı yedeğiyle sızması          | `.gitignore`, CI'da gitleaks, logda secret yazmama kuralı, env doğrulaması; webhook anahtarı ve MFA secret'ı satıra bağlı AES-256-GCM ile şifreli (K-015)                       | Faz 0 ✓, şifreleme Faz 2 ✓          |
| T11 | Tampering / SSRF       | Fiyat akışı ile sahte fiyat ya da API'yi iç ağa istek atmaya yöneltme | Fiyat adresi yalnızca kurulumda girilir, üretimde sadece https, yönlendirme takip edilmez, 2 sn zaman aşımı, 256 KB sınırı; her fiyat ayrı doğrulanır, eski fiyat yeniyi ezemez | Faz 1 ✓                             |

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
- Kurtarma kodu yok. Telefonunu kaybeden yönetici için MFA sıfırlama şimdilik komut satırından; panelden sahip rolüyle 3. adımda.
- Bir yöneticinin bütün oturumlarını tek seferde kapatma ve parola değiştirme 3. adımda. Rol ve MFA değişikliği bugün de açık oturumları etkiliyor (her istekte veritabanı okunur).
- Giriş olayları henüz denetim kaydına yazılmıyor (NFR-07, 3. adım).
- Ana anahtar pilot öncesinde uygulama ortam değişkeninde (K-015). Sunucuyu ele geçiren anahtara da ulaşır. Faz 3.5: OpenBao.
- Oturum çerezi `Secure`. Yerel geliştirmede tarayıcılar `localhost`'u istisna tutuyor; yerel ağdaki başka bir cihazdan `http://` ile açılırsa giriş çalışmaz.
