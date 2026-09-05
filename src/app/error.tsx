"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card pad">
      <h2>Nie udało się wczytać danych</h2>
      <p>
        Spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z
        prowadzącą.
      </p>
      <button className="primary-button" onClick={reset}>
        Spróbuj ponownie
      </button>
    </section>
  );
}
