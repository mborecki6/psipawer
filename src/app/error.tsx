"use client";
export default function Error({ retry }: { error: Error; retry: () => void }) {
  return (
    <section className="card pad">
      <h2>Nie udało się wczytać danych</h2>
      <p>
        Spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z
        prowadzącą.
      </p>
      <button className="primary-button" onClick={retry}>
        Spróbuj ponownie
      </button>
    </section>
  );
}
