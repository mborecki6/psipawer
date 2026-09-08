import Link from "next/link";
export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <h1>Ten trop się urwał.</h1>
        <p>Nie znaleziono tej strony lub nie masz do niej dostępu.</p>
        <Link className="primary-button" href="/">
          Wróć na początek
        </Link>
      </section>
    </main>
  );
}
