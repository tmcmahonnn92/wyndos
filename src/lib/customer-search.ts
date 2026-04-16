function normaliseSearchValue(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchesLooseCustomerSearch(query: string | null | undefined, values: Array<string | null | undefined>) {
  const normalisedQuery = normaliseSearchValue(query ?? "");
  if (!normalisedQuery) return true;

  const tokens = normalisedQuery.split(" ").filter(Boolean);
  const haystack = normaliseSearchValue(values.filter((value): value is string => Boolean(value)).join(" "));
  const words = haystack.split(" ").filter(Boolean);

  return tokens.every((token) =>
    haystack.includes(token) || words.some((word) => word.includes(token))
  );
}