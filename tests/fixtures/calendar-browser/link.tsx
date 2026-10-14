import type { AnchorHTMLAttributes } from "react";
export default function Link({
  scroll,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean }) {
  void scroll;
  return <a {...props} />;
}
