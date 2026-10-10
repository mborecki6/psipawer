import type { AnchorHTMLAttributes } from "react";
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (props.href?.match(/^\/(admin|app)\/services(?:\?|$)/)) {
    const target = new URL(props.href, location.origin);
    const search = new URLSearchParams(location.search);
    search.delete("view");
    search.delete("category");
    if (target.searchParams.has("category"))
      search.set("category", target.searchParams.get("category")!);
    return <a {...props} href={`?${search}`} />;
  }
  return <a {...props} />;
}
