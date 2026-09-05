// Run only against a disposable local/test Supabase project.
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key || process.env.PSI_ALLOW_DEMO_SEED !== "yes")
  throw new Error(
    "Set URL, server secret and PSI_ALLOW_DEMO_SEED=yes for a local/test project.",
  );
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
function check(result) {
  if (result.error) throw result.error;
  return result.data;
}
const suffix = crypto.randomUUID().slice(0, 8);
const accounts = [];
for (const [label, role] of [
  ["Behawiorysta Demo", "admin"],
  ["Opiekun Demo", "client"],
  ["Drugi Opiekun Demo", "client"],
]) {
  const email = `${role}-${accounts.length}-${suffix}@example.test`;
  const { user } = check(
    await db.auth.admin.createUser({ email, email_confirm: true }),
  );
  check(
    await db
      .from("profiles")
      .update({
        full_name: label,
        phone: "000 000 000",
        area: "Wrocław — okolica demonstracyjna",
      })
      .eq("id", user.id),
  );
  check(await db.from("user_roles").update({ role }).eq("user_id", user.id));
  accounts.push({ id: user.id, email });
}
const dogs = [];
for (const [i, name] of ["Kluska", "Borys", "Luna", "Figa"].entries()) {
  const dog = check(
    await db
      .from("dogs")
      .insert({
        guardian_id: accounts[i < 2 ? 1 : 2].id,
        name,
        approximate_age: "około 2 lat",
        breed: "Mieszaniec",
        sex: i % 2 ? "male" : "female",
      })
      .select("id,name")
      .single(),
  );
  check(await db.from("dogs").update({ status: "approved" }).eq("id", dog.id));
  dogs.push(dog);
}
for (const [i, days] of [1, 3, 7].entries()) {
  const w = check(
    await db
      .from("walks")
      .insert({
        starts_at: new Date(Date.now() + days * 86400000).toISOString(),
        duration_minutes: 60,
        public_location: ["Park Pawłowicki", "Niskie Łąki", "Park Zachodni"][i],
        type: "Spacer socjalizacyjny",
        price_cents: 6000,
        capacity: 4,
        leader_id: accounts[0].id,
        info: "Fikcyjny termin do testowania aplikacji.",
      })
      .select("id")
      .single(),
  );
  check(
    await db
      .from("walk_private_details")
      .insert({
        walk_id: w.id,
        exact_location: "Przykładowe miejsce zbiórki — dane testowe",
        instructions: "Zachowaj bezpieczny dystans od innych psów.",
      }),
  );
  if (i === 0)
    for (const [j, status] of ["pending", "accepted", "waitlisted"].entries())
      check(
        await db
          .from("walk_registrations")
          .insert({
            walk_id: w.id,
            dog_id: dogs[j].id,
            status,
            payment_status: status === "accepted" ? "due" : "none",
          }),
      );
}
for (const [i, level] of ["good", "caution", "block"].entries()) {
  const pair = [dogs[0].id, dogs[i + 1].id].sort();
  check(
    await db
      .from("dog_relations")
      .insert({
        dog_a: pair[0],
        dog_b: pair[1],
        level,
        note: "Fikcyjna relacja do testowania ostrzeżeń.",
        author_id: accounts[0].id,
      }),
  );
}
check(
  await db
    .from("psiutki_profiles")
    .insert({
      dog_id: dogs[0].id,
      display_name: "Kluska",
      moderation_status: "approved",
      published: true,
      area: "Wrocław",
      headline:
        "Zawodowo kopię dziury. Prywatnie oceniam inne psy z odległości 40 metrów.",
      seeking: "Spokojnego kumpla, który nie podchodzi bez pytania.",
      traits: ["Dystans to podstawa", "Miłośniczka węszenia"],
      likes: "Spacery w swoim tempie",
      dislikes: "Niespodzianki przy nosie",
    }),
);
console.log(
  "Created fictional demo accounts (no passwords or tokens printed):",
);
accounts.forEach((a) => console.log(a.email));
