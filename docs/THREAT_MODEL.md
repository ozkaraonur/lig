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

| #   | STRIDE                 | Tehdit                                                              | Planlanan kontrol                                                                 | Durum   |
| --- | ---------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------- |
| T1  | Spoofing               | Sahte ya da çalınmış oyuncu token'ı ile başka oyuncu olarak giriş   | RS256 imza doğrulama, `exp` ≤ 5 dk, `aud`/`iss` kontrolü, `jti` ile tek kullanım  | Faz 1   |
| T2  | Tampering              | Eski fiyattan emir vererek kesin kazanç (fiyat arbitrajı)           | Fiyat yaşı ≤ 5 sn, fiyat istemciden alınmaz, sunucu tarafında okunur              | Faz 1   |
| T3  | Tampering              | Aynı emri paralel gönderip bakiyeyi eksiye düşürme (race condition) | Tek transaction, satır kilidi, `cash >= 0` CHECK kısıtı, idempotency key          | Faz 1   |
| T4  | Information disclosure | Tenant A'nın yöneticisi tenant B'nin verisini görür (IDOR)          | Her sorguda tenant filtresi, yetki testleri, Faz 4'te PostgreSQL RLS              | Faz 1–4 |
| T5  | Spoofing               | Sahte webhook ile dönüşüm metriğini şişirme                         | HMAC imzası, zaman damgası penceresi, `external_event_id` benzersizliği           | Faz 2   |
| T6  | Elevation of privilege | Yönetici hesabının ele geçirilmesi                                  | Güçlü parola hash'i (argon2id), zorunlu MFA, oturum süresi, giriş denemesi sınırı | Faz 2   |
| T7  | Repudiation            | Lig ayarının kim tarafından değiştirildiğinin inkârı                | Değiştirilemez denetim kaydı (NFR-07)                                             | Faz 2   |
| T8  | Tampering              | Prompt injection ile AI koçun al/sat önerisi vermesi                | Çıktı filtresi, sistem talimatı, yanıt kaydı, kötü niyetli girdi test seti        | Faz 3   |
| T9  | Denial of service      | Emir ve sıralama uçlarına yoğun istek                               | Oyuncu ve tenant başına rate limit, gövde boyutu sınırı (64 KB)                   | Faz 1–4 |
| T10 | Information disclosure | Secret'ların repoya ya da loga sızması                              | `.gitignore`, CI'da gitleaks, logda secret yazmama kuralı, env doğrulaması        | Faz 0 ✓ |
