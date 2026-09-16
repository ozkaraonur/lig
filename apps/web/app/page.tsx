import { MAX_PRICE_AGE_MS } from '@lig/shared';

export default function PlayerHome() {
  return (
    <main>
      <h1>Ligler</h1>
      <p>Oyuncu ekranları Faz 1&apos;de burada olacak.</p>
      <p>Emir motoru fiyatı en fazla {MAX_PRICE_AGE_MS / 1000} saniye eski kabul eder.</p>
    </main>
  );
}
