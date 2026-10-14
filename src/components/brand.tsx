import Image from "next/image";
import styles from "./brand.module.css";

export const brandSlogan = "Problemy to wyzwania, którym stawiaMY czoła!";

export function Brand({
  className = "",
  showSlogan = true,
}: {
  className?: string;
  showSlogan?: boolean;
}) {
  return (
    <div className={`${styles.brand} ${className}`}>
      <Image
        className={styles.logo}
        src="/brand/psi-pawer-logo.png"
        alt="Psi Pawer"
        width={302}
        height={212}
        unoptimized
      />
      {showSlogan && <p className={styles.slogan}>{brandSlogan}</p>}
    </div>
  );
}
