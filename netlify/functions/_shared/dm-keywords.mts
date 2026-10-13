const normalize = (value: string) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function keywordHit(keywords: string[] | undefined, text: string): boolean {
  const haystack = normalize(text);
  return (keywords || []).some((value) => {
    const needle = normalize(String(value || "")).replace(/^#+/, "").trim();
    if (!needle) return false;
    if (/^[\x00-\x7f]+$/.test(needle) && /[a-z]/.test(needle)) {
      // Keep short English keywords out of other English words.
      const pattern = needle.split(" ").map(escapeRegex).join("\\s*");
      return new RegExp(`(?:^|[^a-z0-9_])${pattern}(?=$|[^a-z0-9_])`).test(haystack);
    }
    if (haystack.includes(needle)) return true;
    const tolerateSpaces = needle.includes(" ") || (/[^\x00-\x7f]/.test(needle) && Array.from(needle).length >= 3);
    return tolerateSpaces && haystack.replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
  });
}
