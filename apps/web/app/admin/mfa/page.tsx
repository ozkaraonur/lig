import { MfaCodeForm } from './code-form';

export default function AdminMfaPage() {
  return (
    <main>
      <h1>İki adımlı doğrulama</h1>
      <p>Doğrulama uygulamandaki Lig kodunu gir.</p>
      <MfaCodeForm submitLabel="Giriş yap" />
    </main>
  );
}
