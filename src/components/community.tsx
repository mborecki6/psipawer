import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ChevronDown,
  EyeOff,
  Heart,
  HeartHandshake,
  MapPin,
  PawPrint,
  PencilLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { Empty } from "@/components/ui";
import { dateLabel } from "@/lib/domain";
import type {
  CommunityData,
  CommunityInterest,
  CommunityManagedProfile,
  CommunityProfile,
  CommunityTab,
} from "@/lib/community";
import {
  expressCommunityInterest,
  hideCommunityProfile,
  moderateCommunityProfile,
  reviewCommunityInterest,
  saveCommunityProfile,
  uploadCommunityAvatar,
  withdrawCommunityInterest,
} from "@/lib/data/community-actions";
import styles from "./community.module.css";

function Details({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <details className={styles.details}>
      <summary>
        <span>
          {icon}
          {title}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}

function ProfileFields({ profile }: { profile: CommunityProfile }) {
  return (
    <>
      <div className={styles.profileHeading}>
        <h3>{profile.display_name}</h3>
        {profile.area && (
          <p className={styles.area}>
            <MapPin aria-hidden="true" />
            {profile.area}
          </p>
        )}
      </div>
      <p className={styles.headline}>{profile.headline}</p>
      {!!profile.traits.length && (
        <div className={styles.traits}>
          {profile.traits.map((trait, index) => (
            <span className={styles.trait} key={`${trait}-${index}`}>
              {trait}
            </span>
          ))}
        </div>
      )}
      <div className={styles.seeking}>
        <strong>
          <HeartHandshake aria-hidden="true" />
          Szukam towarzystwa
        </strong>
        <p>{profile.seeking}</p>
      </div>
      {(profile.likes || profile.dislikes) && (
        <dl className={styles.preferences}>
          {profile.likes && (
            <div>
              <dt>Lubię</dt>
              <dd>{profile.likes}</dd>
            </div>
          )}
          {profile.dislikes && (
            <div>
              <dt>Wolę bez</dt>
              <dd>{profile.dislikes}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}

function ProfileCover({
  profile,
  index = 0,
}: {
  profile: CommunityProfile;
  index?: number;
}) {
  if (profile.avatarUrl)
    return (
      <Image
        className={styles.profilePhoto}
        src={profile.avatarUrl}
        alt={`Portret psa ${profile.display_name}`}
        width={640}
        height={420}
        loading="eager"
        unoptimized
      />
    );
  const tone =
    index % 3 === 1
      ? styles.coverClay
      : index % 3 === 2
        ? styles.coverSand
        : "";
  return (
    <div className={`${styles.cover} ${tone}`} aria-hidden="true">
      <span className={styles.monogram}>
        {profile.display_name.trim().slice(0, 2).toLocaleUpperCase("pl-PL")}
      </span>
      <PawPrint className={styles.coverPaw} />
    </div>
  );
}

function InterestButton({
  profile,
  data,
  base,
}: {
  profile: CommunityProfile;
  data: CommunityData;
  base: string;
}) {
  if (data.mine.some((item) => item.dogId === profile.dog_id))
    return (
      <Link
        className="secondary-button"
        href={`${base}/community?tab=mine#my-${profile.dog_id}`}
      >
        <PencilLine aria-hidden="true" />
        Twoja wizytówka
      </Link>
    );
  if (!data.senders.length)
    return (
      <Details title="Chcemy Was poznać" icon={<Heart aria-hidden="true" />}>
        <p>
          Najpierw dodaj i opublikuj wizytówkę swojego psa. Dzięki temu inne
          Psiutki też będą mogły Was poznać.
        </p>
        <Link className="ghost-button" href={`${base}/community?tab=mine`}>
          Przejdź do moich wizytówek →
        </Link>
      </Details>
    );
  const eligible = data.senders.filter(
    (sender) =>
      !data.sentPairs.some(
        (pair) =>
          pair.fromDogId === sender.id &&
          pair.toDogId === profile.dog_id &&
          (pair.rejectionActive ||
            (pair.status !== "withdrawn" &&
              !(pair.status === "open" && !pair.confirmedAt))),
      ),
  );
  const rejected = data.sentPairs.some(
    (pair) => pair.toDogId === profile.dog_id && pair.rejectionActive,
  );
  const reconfirming = eligible.some((sender) =>
    data.sentPairs.some(
      (pair) =>
        pair.fromDogId === sender.id &&
        pair.toDogId === profile.dog_id &&
        pair.status === "open" &&
        !pair.confirmedAt,
    ),
  );
  if (!eligible.length)
    return (
      <>
        <Link
          className="secondary-button"
          href={`${base}/community?tab=interests`}
        >
          <Heart aria-hidden="true" />
          {rejected
            ? "Sprawdź decyzję prowadzącej"
            : "Zainteresowanie zgłoszone"}
        </Link>
        {rejected && (
          <p className={`${styles.notice} ${styles.noticeAmber}`}>
            Prowadząca na razie nie proponuje wspólnego spaceru dla tej pary.
            Skontaktuj się z nią przed ponownym zgłoszeniem.
          </p>
        )}
      </>
    );
  return (
    <Details title="Chcemy Was poznać" icon={<Heart aria-hidden="true" />}>
      <p>
        Wybierz psa, który chce poznać {profile.display_name}. Jeśli sympatia
        będzie wzajemna, propozycję sprawdzi behawiorysta.
      </p>
      {reconfirming && (
        <p className={styles.notice}>
          Wizytówka zmieniła się od ostatniej propozycji. Przeczytaj aktualny
          opis przed ponownym potwierdzeniem zainteresowania.
        </p>
      )}
      <ActionForm
        action={expressCommunityInterest}
        label={
          reconfirming ? "Potwierdź zainteresowanie" : "Zgłoś zainteresowanie"
        }
        pendingLabel="Zapisuję propozycję…"
      >
        <input type="hidden" name="to_dog_id" value={profile.dog_id} />
        <label className="field">
          <span>Twój pies</span>
          <select name="from_dog_id" required defaultValue={eligible[0].id}>
            {eligible.map((sender) => (
              <option key={sender.id} value={sender.id}>
                {sender.name}
              </option>
            ))}
          </select>
        </label>
      </ActionForm>
    </Details>
  );
}

function Consent({ photo = false }: { photo?: boolean }) {
  return (
    <label className={styles.consent}>
      <input name="consent" type="checkbox" value="yes" required />
      <span>
        {photo
          ? "Zgadzam się na pokazanie tego zdjęcia w Psiutkach zalogowanym użytkownikom po zatwierdzeniu przez behawiorystę. Zdjęcie przedstawia mojego psa i mogę je udostępnić."
          : "Zgadzam się na pokazanie tej wizytówki w Psiutkach zalogowanym użytkownikom po zatwierdzeniu przez behawiorystę. Wizytówkę mogę w każdej chwili ukryć."}
      </span>
    </label>
  );
}

function TextArea({
  label,
  name,
  value,
  maxLength,
  required = false,
  hint,
}: {
  label: string;
  name: string;
  value?: string;
  maxLength: number;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        name={name}
        defaultValue={value || ""}
        rows={3}
        required={required}
        maxLength={maxLength}
      />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function ProfileForm({ managed }: { managed: CommunityManagedProfile }) {
  const profile = managed.profile;
  return (
    <>
      <p>
        To osobna, widoczna dla społeczności wizytówka. Nie wpisuj numeru
        telefonu, dokładnego adresu, informacji o zdrowiu ani prywatnych zaleceń
        behawiorysty.
      </p>
      <ActionForm
        action={saveCommunityProfile}
        label={
          profile
            ? "Zapisz i przekaż do sprawdzenia"
            : "Dodaj wizytówkę do sprawdzenia"
        }
        pendingLabel="Zapisuję wizytówkę…"
      >
        <input type="hidden" name="dog_id" value={managed.dogId} />
        <input
          type="hidden"
          name="expected_updated_at"
          value={profile?.updated_at || ""}
        />
        <input
          type="hidden"
          name="avatar_path"
          value={profile?.avatar_path || ""}
        />
        <div className="form-grid">
          <Field
            name="display_name"
            label="Imię w Psiutkach"
            value={profile?.display_name || managed.dogName}
            maxLength={80}
            required
          />
          <Field
            name="area"
            label="Ogólna okolica"
            value={profile?.area || ""}
            placeholder="np. Wrocław, Krzyki"
            maxLength={120}
          />
        </div>
        <TextArea
          name="headline"
          label="Kilka słów o mnie"
          value={profile?.headline}
          maxLength={280}
          required
          hint="Krótko i po psiemu. Co najlepiej opisuje Twojego psa?"
        />
        <TextArea
          name="seeking"
          label="Jakiego towarzystwa szukamy?"
          value={profile?.seeking}
          maxLength={500}
          required
        />
        <Field
          name="traits"
          label="Cechy, po przecinku"
          value={profile?.traits.join(", ") || ""}
          maxLength={334}
          placeholder="np. spokojny, ciekawski, węszyciel"
          hint="Maksymalnie 8 cech, każda do 40 znaków."
        />
        <TextArea
          name="likes"
          label="Lubię (opcjonalnie)"
          value={profile?.likes}
          maxLength={500}
        />
        <TextArea
          name="dislikes"
          label="Wolę bez (opcjonalnie)"
          value={profile?.dislikes}
          maxLength={500}
        />
        {profile?.avatar_path && (
          <label className={styles.consent}>
            <input name="remove_avatar" type="checkbox" value="yes" />
            <span>Usuń zdjęcie z wizytówki przy zapisie</span>
          </label>
        )}
        {profile && (
          <p className={styles.formHint}>
            Po zmianie opisu wizytówka zniknie z katalogu do czasu ponownego
            zatwierdzenia.
          </p>
        )}
        <Consent />
      </ActionForm>
    </>
  );
}

function ManagedStatus({ item }: { item: CommunityManagedProfile }) {
  const profile = item.profile;
  const consented = !!item.review?.consented_at;
  if (!profile)
    return <span className="badge neutral">Jeszcze bez wizytówki</span>;
  if (profile.published && profile.moderation_status === "approved")
    return <span className="badge green">Widoczna w Psiutkach</span>;
  if (!consented || (profile.moderation_status === "approved" && !profile.published))
    return <span className="badge neutral">Ukryta</span>;
  return (
    <span
      className={`badge ${profile.moderation_status === "rejected" ? "red" : "amber"}`}
    >
      {profile.moderation_status === "rejected"
        ? "Do poprawy"
        : "Do sprawdzenia"}
    </span>
  );
}

function OwnerCard({ item }: { item: CommunityManagedProfile }) {
  const profile = item.profile;
  const consented = !!item.review?.consented_at;
  return (
    <article className={styles.ownCard} id={`my-${item.dogId}`}>
      <div className={styles.ownerHeader}>
        <div>
          <h3>{item.dogName}</h3>
          <p>Twoja wizytówka w społeczności</p>
        </div>
        <ManagedStatus item={item} />
      </div>
      {profile?.published && (
        <p className={styles.notice}>
          Wizytówka jest dostępna w katalogu. Zmiana opisu lub zdjęcia wymaga
          ponownego sprawdzenia.
        </p>
      )}
      {consented && profile?.moderation_status === "pending" && (
        <p className={`${styles.notice} ${styles.noticeAmber}`}>
          Wizytówka czeka na sprawdzenie przez behawiorystę. Pojawi się w
          katalogu po zatwierdzeniu.
        </p>
      )}
      {consented && profile?.moderation_status === "rejected" && (
        <p className={`${styles.notice} ${styles.noticeRed}`}>
          <strong>Popraw wizytówkę przed publikacją.</strong>
          {item.review?.moderation_note
            ? `\nWiadomość od prowadzącej: ${item.review.moderation_note}`
            : "\nZmień opis i przekaż go do ponownego sprawdzenia."}
        </p>
      )}
      {profile && !consented && (
        <p className={styles.notice}>
          Wizytówka jest ukryta. Jeśli chcesz wrócić do katalogu, zapisz ją
          ponownie i wyraź zgodę na publikację.
        </p>
      )}
      <Details
        title={profile ? "Edytuj wizytówkę" : "Utwórz wizytówkę psa"}
        icon={<PencilLine aria-hidden="true" />}
      >
        <ProfileForm managed={item} />
      </Details>
      {profile && (
        <Details
          title="Zdjęcie do Psiutków"
          icon={<Upload aria-hidden="true" />}
        >
          <p>
            Dodaj osobne zdjęcie do wizytówki. Zmiana ukryje ją do ponownego
            zatwierdzenia.
          </p>
          {profile.avatarUrl && (
            <Image
              className={styles.ownerPhoto}
              src={profile.avatarUrl}
              alt={`Zdjęcie do wizytówki psa ${profile.display_name}`}
              width={320}
              height={220}
              loading="eager"
              unoptimized
            />
          )}
          <ActionForm
            action={uploadCommunityAvatar}
            label="Dodaj zdjęcie do sprawdzenia"
            pendingLabel="Zapisuję zdjęcie…"
          >
            <input type="hidden" name="dog_id" value={item.dogId} />
            <input
              type="hidden"
              name="expected_updated_at"
              value={profile.updated_at}
            />
            <label className="field">
              <span>Zdjęcie psa</span>
              <input
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required
              />
              <small className="field-hint">
                JPG, PNG lub WebP, maksymalnie 1,5 MB.
              </small>
            </label>
            <Consent photo />
          </ActionForm>
        </Details>
      )}
      {profile && (profile.published || consented) && (
        <Details title="Ukryj wizytówkę" icon={<EyeOff aria-hidden="true" />}>
          <p>
            Wizytówka zniknie z katalogu. Jej treść pozostanie w Twoim panelu.
          </p>
          <ActionForm
            action={hideCommunityProfile}
            label="Ukryj wizytówkę"
            confirm={`Ukryć wizytówkę psa ${item.dogName}? Nie będzie widoczna w katalogu Psiutków.`}
          >
            <input type="hidden" name="dog_id" value={item.dogId} />
          </ActionForm>
        </Details>
      )}
    </article>
  );
}

function ModerationCard({
  item,
  index,
}: {
  item: CommunityManagedProfile;
  index: number;
}) {
  const profile = item.profile;
  if (!profile) return null;
  const consented = !!item.review?.consented_at;
  return (
    <article className={styles.profileCard}>
      <ProfileCover profile={profile} index={index} />
      <div className={styles.profileBody}>
        <div className={styles.ownerHeader}>
          <ManagedStatus item={item} />
          <p>Opiekun: {item.guardianName}</p>
        </div>
        <ProfileFields profile={profile} />
        {item.review?.moderation_note && (
          <p className={styles.notice}>
            Ostatnia decyzja: {item.review.moderation_note}
          </p>
        )}
        {consented ? (
          <Details
            title="Sprawdź i zdecyduj"
            icon={<ShieldCheck aria-hidden="true" />}
          >
            <p>
              Sprawdź, czy opis i zdjęcie nadają się do pokazania społeczności.
              Ta decyzja dotyczy wizytówki, a nie kwalifikacji psa na spacer.
            </p>
            <ActionForm
              action={moderateCommunityProfile}
              label="Zapisz decyzję"
            >
              <input type="hidden" name="dog_id" value={profile.dog_id} />
              <input
                type="hidden"
                name="expected_updated_at"
                value={profile.updated_at}
              />
              <label className="field">
                <span>Decyzja o wizytówce</span>
                <select name="decision" required defaultValue="">
                  <option value="" disabled>
                    Wybierz decyzję
                  </option>
                  <option value="approved">Zatwierdź i opublikuj</option>
                  <option value="rejected">Odrzuć do poprawy</option>
                </select>
              </label>
              <TextArea
                name="note"
                label="Wiadomość dla opiekuna"
                maxLength={2000}
                required
                hint="Przy odrzuceniu wskaż konkretnie, co poprawić. Nie wpisuj tu prywatnych notatek behawioralnych."
              />
            </ActionForm>
          </Details>
        ) : (
          <p className={styles.notice}>
            Opiekun nie wyraził aktualnej zgody na publikację. Wizytówka
            pozostaje ukryta.
          </p>
        )}
        {profile.published && (
          <Details
            title="Ukryj opublikowaną wizytówkę"
            icon={<EyeOff aria-hidden="true" />}
          >
            <ActionForm
              action={hideCommunityProfile}
              label="Ukryj wizytówkę"
              confirm={`Ukryć wizytówkę psa ${profile.display_name} w społeczności?`}
            >
              <input type="hidden" name="dog_id" value={profile.dog_id} />
            </ActionForm>
          </Details>
        )}
      </div>
    </article>
  );
}

const interestLabels: Record<CommunityInterest["status"], string> = {
  open: "Zainteresowanie zgłoszone",
  matched: "Wzajemne zainteresowanie",
  reviewed: "Sprawdzone przez prowadzącą",
  rejected: "Na razie bez wspólnego spaceru",
  withdrawn: "Zainteresowanie wycofane",
};

function InterestCard({
  interest,
  admin,
}: {
  interest: CommunityInterest;
  admin: boolean;
}) {
  const statusClass =
    interest.status === "matched"
      ? "amber"
      : interest.status === "reviewed"
        ? "green"
        : "neutral";
  const canReview =
    admin &&
    interest.profilesAvailable &&
    ["matched", "reviewed", "rejected"].includes(interest.status);
  return (
    <article className={styles.interestCard}>
      <div className={styles.pair}>
        <h3>{interest.fromName}</h3>
        {admin ? (
          <HeartHandshake aria-label="i" />
        ) : (
          <ArrowRight aria-label="chce poznać" />
        )}
        <h3>{interest.toName}</h3>
      </div>
      <p className={styles.interestMeta}>
        <span className={`badge ${statusClass}`}>
          {interest.needsConfirmation
            ? "Wymaga ponownego potwierdzenia"
            : interestLabels[interest.status]}
        </span>
        <time dateTime={interest.created_at}>
          {dateLabel(interest.created_at)}
        </time>
      </p>
      {!interest.profilesAvailable && (
        <p className={styles.notice}>
          Jedna z wizytówek jest teraz niedostępna. Propozycja pozostaje w
          historii; powrót do niej wymaga aktualnych, opublikowanych profili.
        </p>
      )}
      {interest.rejection_active && !admin && (
        <p className={`${styles.notice} ${styles.noticeAmber}`}>
          Prowadząca na razie nie proponuje wspólnego spaceru dla tej pary.
          Wycofanie propozycji nie zmienia tej decyzji — skontaktuj się z
          prowadzącą, aby ustalić kolejny krok.
        </p>
      )}
      {interest.status === "matched" &&
        interest.profilesAvailable &&
        !admin && (
          <p className={`${styles.notice} ${styles.noticeAmber}`}>
            Sympatia jest wzajemna. Przed ustaleniem wspólnego spaceru
            propozycję sprawdzi behawiorysta.
          </p>
        )}
      {interest.review_note && (
        <p className={styles.notice}>
          <strong>Wiadomość od prowadzącej</strong>
          {`\n${interest.review_note}`}
          {interest.reviewed_at && (
            <>
              <br />
              <time dateTime={interest.reviewed_at}>
                {dateLabel(interest.reviewed_at)}
              </time>
            </>
          )}
        </p>
      )}
      {!admin &&
        interest.needsConfirmation &&
        interest.profilesAvailable &&
        !interest.rejection_active && (
          <Details
            title="Potwierdź po zmianie wizytówki"
            icon={<Heart aria-hidden="true" />}
          >
            <p>
              Co najmniej jedna wizytówka zmieniła się. Przeczytaj aktualne
              opisy przed ponownym zgłoszeniem chęci poznania psów.
            </p>
            <Link
              className="ghost-button"
              href={`/app/community?tab=catalog#psiutek-${interest.to_dog_id}`}
            >
              Zobacz aktualną wizytówkę →
            </Link>
            <ActionForm
              action={expressCommunityInterest}
              label="Potwierdź ponownie zainteresowanie"
            >
              <input
                type="hidden"
                name="from_dog_id"
                value={interest.from_dog_id}
              />
              <input
                type="hidden"
                name="to_dog_id"
                value={interest.to_dog_id}
              />
            </ActionForm>
          </Details>
        )}
      {canReview && (
        <Details
          title="Sprawdź propozycję spotkania"
          icon={<ShieldCheck aria-hidden="true" />}
        >
          <p>
            Uwzględnij kwalifikację i relacje psów. Informacja poniżej będzie
            widoczna dla obu opiekunów.
          </p>
          <ActionForm
            action={reviewCommunityInterest}
            label="Zapisz decyzję o propozycji"
          >
            <input type="hidden" name="interest_id" value={interest.id} />
            <input
              type="hidden"
              name="expected_updated_at"
              value={interest.updated_at}
            />
            <label className="field">
              <span>Decyzja prowadzącej</span>
              <select name="decision" defaultValue="" required>
                <option value="" disabled>
                  Wybierz decyzję
                </option>
                <option value="reviewed">
                  Sprawdzone — można ustalać spotkanie
                </option>
                <option value="rejected">
                  Na razie nie proponuję wspólnego spaceru
                </option>
              </select>
            </label>
            <TextArea
              name="note"
              label="Wskazówka dla opiekunów"
              maxLength={2000}
              required
              hint="Opisz następny krok, bez ujawniania prywatnej dokumentacji psów."
            />
          </ActionForm>
        </Details>
      )}
      {!admin && interest.canWithdraw && (
        <Details
          title="Wycofaj zainteresowanie"
          icon={<EyeOff aria-hidden="true" />}
        >
          <ActionForm
            action={withdrawCommunityInterest}
            label="Wycofaj zainteresowanie"
            confirm="Wycofać tę propozycję poznania psów? Wcześniejsza ocena wspólnego spotkania przestanie być aktualna."
          >
            <input type="hidden" name="interest_id" value={interest.id} />
          </ActionForm>
        </Details>
      )}
    </article>
  );
}

export function CommunityView({
  data,
  admin,
  tab = "catalog",
}: {
  data: CommunityData;
  admin: boolean;
  tab: CommunityTab;
}) {
  const base = admin ? "/admin" : "/app";
  const pending = data.moderation.filter(
    (item) =>
      item.profile?.moderation_status === "pending" &&
      item.review?.consented_at,
  );
  const otherModeration = data.moderation.filter(
    (item) => !pending.includes(item),
  );
  const interests = admin
    ? data.interests.filter((item) =>
        ["matched", "reviewed", "rejected"].includes(item.status),
      )
    : data.interests;
  const tabs = [
    { key: "catalog", name: "Poznaj Psiutki", count: data.catalog.length },
    { key: "mine", name: "Moje wizytówki", count: data.mine.length },
    ...(admin
      ? [{ key: "moderation", name: "Moderacja", count: pending.length }]
      : []),
    {
      key: "interests",
      name: admin ? "Psie sympatie" : "Moje propozycje",
      count: admin
        ? data.totals.mutual
        : data.interests.filter((item) => item.status !== "withdrawn").length,
    },
  ];
  return (
    <div className={styles.root}>
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>
            Mała społeczność. Wielkie osobowości.
          </span>
          <h2>Każdy pies ma w sobie coś do pokochania.</h2>
          <p>
            Poznaj psie sympatie, ulubione zajęcia i małe dziwactwa. Dobry
            wspólny spacer zaczyna się od poznania siebie.
          </p>
        </div>
        <div className={styles.introMark} aria-hidden="true">
          <PawPrint />
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Widoki Psiutków">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`${base}/community?tab=${item.key}`}
            aria-current={tab === item.key ? "page" : undefined}
          >
            {item.name}
            <span className={styles.tabCount}>{item.count}</span>
          </Link>
        ))}
      </nav>
      {tab === "catalog" && (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Poznaj Psiutki</h2>
              <p>
                Wizytówki opublikowane przez opiekunów i zatwierdzone przez
                behawiorystę.
              </p>
            </div>
          </div>
          {data.catalog.length ? (
            <div className={styles.catalog}>
              {data.catalog.map((profile, index) => (
                <article
                  className={styles.profileCard}
                  key={profile.dog_id}
                  id={`psiutek-${profile.dog_id}`}
                >
                  <ProfileCover profile={profile} index={index} />
                  <div className={styles.profileBody}>
                    <ProfileFields profile={profile} />
                    <div className={styles.cardAction}>
                      <InterestButton
                        profile={profile}
                        data={data}
                        base={base}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <article className="card">
              <Empty
                title="Pierwsze psie historie zaczynają się tutaj"
                copy="Dodaj wizytówkę swojego psa. Po sprawdzeniu pojawi się w katalogu i będzie można zgłaszać chęć poznania innych Psiutków."
                href={`${base}/community?tab=mine`}
                action="Przejdź do moich wizytówek"
              />
            </article>
          )}
        </>
      )}
      {tab === "mine" && (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Moje wizytówki</h2>
              <p>
                Ty decydujesz, co pokażesz społeczności. Po każdej zmianie opis
                lub zdjęcie trafia do ponownego sprawdzenia.
              </p>
            </div>
          </div>
          {data.mine.length ? (
            <div className={styles.ownGrid}>
              {data.mine.map((item) => (
                <OwnerCard key={item.dogId} item={item} />
              ))}
            </div>
          ) : (
            <article className="card">
              <Empty
                title="Najpierw poznajmy Twojego psa"
                copy="Wizytówkę można dodać dla psa, którego profil prowadzisz w swoim panelu."
                href={`${base}/dogs`}
                action="Przejdź do moich psów"
              />
            </article>
          )}
        </>
      )}
      {tab === "moderation" && admin && (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Wizytówki do sprawdzenia</h2>
              <p>
                Sprawdź opis, zdjęcie i zgodę opiekuna. Zatwierdzenie udostępni
                wizytówkę w katalogu Psiutków.
              </p>
            </div>
          </div>
          {pending.length ? (
            <div className={styles.catalog}>
              {pending.map((item, index) => (
                <ModerationCard key={item.dogId} item={item} index={index} />
              ))}
            </div>
          ) : (
            <article className="card">
              <Empty
                title="Wszystkie nowe wizytówki sprawdzone"
                copy="Zgłoszone opisy i zdjęcia pojawią się tutaj, gdy opiekun przekaże je do publikacji."
              />
            </article>
          )}
          {!!otherModeration.length && (
            <Details title={`Pozostałe wizytówki (${otherModeration.length})`}>
              <div className={styles.catalog}>
                {otherModeration.map((item, index) => (
                  <ModerationCard key={item.dogId} item={item} index={index} />
                ))}
              </div>
            </Details>
          )}
        </>
      )}
      {tab === "interests" && (
        <>
          <div className={styles.sectionHeader}>
            <div>
              <h2>
                {admin ? "Wzajemne psie sympatie" : "Moje propozycje poznania"}
              </h2>
              <p>
                {admin
                  ? "Wzajemne zainteresowanie jest początkiem rozmowy o wspólnym spacerze. Sprawdź potrzeby i relacje psów przed ustaleniem kolejnego kroku."
                  : "Tutaj znajdziesz zainteresowania zgłoszone przez Twoje psy oraz wskazówki prowadzącej, gdy sympatia będzie wzajemna."}
              </p>
            </div>
          </div>
          {interests.length ? (
            <div className={styles.interestList}>
              {interests.map((item) => (
                <InterestCard key={item.id} interest={item} admin={admin} />
              ))}
            </div>
          ) : (
            <article className="card">
              <Empty
                title={
                  admin
                    ? "Na razie bez wzajemnych propozycji"
                    : "Jeszcze nikomu nie pomerdaliśmy"
                }
                copy={
                  admin
                    ? "Gdy opiekunowie zgłoszą wzajemną chęć poznania psów, propozycja trafi tutaj do sprawdzenia."
                    : "Zajrzyj do katalogu i zgłoś, kogo Twój pies chciałby poznać."
                }
                href={`${base}/community?tab=catalog`}
                action="Poznaj Psiutki"
              />
            </article>
          )}
        </>
      )}
      <p className={styles.privacyNote}>
        <ShieldCheck aria-hidden="true" />
        <span>
          Kontakt i wspólne spacery ustalacie z behawiorystą. W Psiutkach nie
          pokazujemy numerów telefonów, dokładnych adresów ani prywatnych
          notatek o psach.
        </span>
      </p>
    </div>
  );
}
