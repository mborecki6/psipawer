export default function Demo() {
  return (
    <>
      <div className="demo-ribbon">
        PODGLĄD · fikcyjne dane · zmiany zapisują się wyłącznie w tej
        przeglądarce <a href="/login">Wróć do logowania</a>
      </div>
      <iframe
        className="prototype-frame"
        title="Demonstracyjny panel Psi Pawer"
        src="/reference/prototype.html"
      />
    </>
  );
}
