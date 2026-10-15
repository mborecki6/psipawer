import Image from "next/image";
import styles from "./shell.module.css";

export function PanelBackdrop({ path }: { path: string }) {
  const section = path.split("/")[2];
  const scene = ["walks", "calendar"].includes(section)
    ? "training-walk"
    : [
          "activities",
          "courses",
          "fitness",
          "services",
          "service-requests",
        ].includes(section)
      ? "training-play"
      : ["dogs", "care", "consultations", "community", "relations"].includes(
            section,
          )
        ? "training-reward"
        : "asia-outdoors";
  const portrait = scene === "training-play" || scene === "training-reward";
  return (
    <div
      className={`${styles.backdrop} ${portrait ? styles.portraitBackdrop : ""}`}
      data-scene={scene}
      aria-hidden="true"
    >
      <Image
        src={`/brand/${scene}-clean.webp`}
        alt=""
        fill
        sizes={
          portrait
            ? "(max-width: 760px) 54vw, 420px"
            : "(max-width: 760px) 100vw, (max-width: 1200px) 80vw, 1100px"
        }
      />
    </div>
  );
}
