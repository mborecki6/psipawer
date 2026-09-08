import { DogForm } from "@/components/dogs";
import { requireSession } from "@/lib/auth/session";
export default async function Page() {
  await requireSession("client");
  return (
    <article className="card pad form-card">
      <h2>Poznajmy Twojego psa</h2>
      <p className="muted">
        Po zapisaniu profilu uzupełnij kwestionariusz. Pomoże nam dobrać
        odpowiedni spacer.
      </p>
      <DogForm />
    </article>
  );
}
