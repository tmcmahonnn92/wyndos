/**
 * One address, stored as parts so a day can be sorted by street and house number.
 *
 *   houseNameNumber  "29", "4a", "Eden House", "Flat 2, 10"
 *   street           "Beardsley Road"
 *   town             "Edwinstowe"
 *   postcode         "NG21 9AA"
 *
 * Customer.address stays as the single display line, always rebuilt from the parts.
 */

export type AddressParts = {
  houseNameNumber: string;
  street: string;
  town: string;
  postcode: string;
};

export const EMPTY_ADDRESS: AddressParts = { houseNameNumber: "", street: "", town: "", postcode: "" };

const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

const STREET_SUFFIXES = new Set([
  "road", "rd", "street", "st", "avenue", "ave", "av", "lane", "ln", "close", "cl", "drive", "dr",
  "way", "crescent", "cres", "court", "ct", "grove", "gr", "gardens", "gdns", "terrace", "ter", "hill",
  "view", "place", "pl", "walk", "row", "green", "square", "sq", "mews", "park", "rise", "croft",
  "meadow", "meadows", "fields", "field", "vale", "end", "side", "bank", "gate", "yard", "parade",
  "boulevard", "approach", "chase", "wharf", "hollow", "top",
]);

export function normalisePostcode(value: string) {
  const compact = value.toUpperCase().replace(/\s+/g, "").trim();
  if (compact.length <= 3) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function tidyCase(value: string) {
  // Only fix all-lower or ALL-UPPER text; leave mixed case as the user typed it.
  const v = value.trim().replace(/\s+/g, " ");
  if (!v || (v !== v.toLowerCase() && v !== v.toUpperCase())) return v;
  return v.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Build the single display line from the parts. */
export function composeAddress(parts: Partial<AddressParts>) {
  const house = (parts.houseNameNumber ?? "").trim();
  const street = (parts.street ?? "").trim();
  const firstLine = house && street && /^\d/.test(house) && !house.includes(",") ? `${house} ${street}` : [house, street].filter(Boolean).join(", ");
  return [firstLine, (parts.town ?? "").trim(), normalisePostcode(parts.postcode ?? "")].filter(Boolean).join(", ");
}

/**
 * Best-effort split of a free-text address into parts.
 * `knownTowns` (lower case) helps when there is no comma: "eden house cuckney"
 * is only split into "Eden House" + "Cuckney" if Cuckney is a known town.
 */
export function splitAddress(raw: string, knownTowns: Set<string> = new Set()): AddressParts {
  let text = raw.trim().replace(/\s+/g, " ");
  if (!text) return { ...EMPTY_ADDRESS };

  let postcode = "";
  const pc = text.match(POSTCODE_RE);
  if (pc) {
    postcode = normalisePostcode(pc[0]);
    text = text.replace(pc[0], "").replace(/[,\s]+$/, "").replace(/^[,\s]+/, "").trim();
  }

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let house = "";
  let street = "";
  let town = "";

  const takeNumber = (s: string) => {
    const m = s.match(/^((?:flat|apt|unit)\s+\S+\s+)?(\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?)\s+(.*)$/i);
    return m ? { number: `${m[1] ?? ""}${m[2]}`.trim(), rest: m[3] } : null;
  };

  // Split "beardsley rd edwinstowe" at the street suffix: street = up to suffix, town = after.
  const splitAtSuffix = (words: string[]) => {
    const idx = words.findIndex((w, i) => i > 0 && STREET_SUFFIXES.has(w.toLowerCase().replace(/\.$/, "")));
    if (idx === -1) return null;
    return { street: words.slice(0, idx + 1).join(" "), after: words.slice(idx + 1).join(" ") };
  };

  if (parts.length >= 2) {
    const first = takeNumber(parts[0]);
    if (first) {
      house = first.number;
      street = first.rest;
      town = parts.slice(1).join(", ");
    } else {
      // "Eden House, Main Street, Cuckney" or "Eden House, Cuckney"
      house = parts[0];
      const second = takeNumber(parts[1]);
      if (parts.length >= 3) {
        street = parts[1];
        town = parts.slice(2).join(", ");
      } else if (second || splitAtSuffix(parts[1].split(" "))) {
        street = parts[1];
      } else {
        town = parts[1];
      }
    }
  } else {
    const single = parts[0] ?? "";
    const numbered = takeNumber(single);
    const words = (numbered ? numbered.rest : single).split(" ");
    const cut = splitAtSuffix(words);
    if (numbered) {
      house = numbered.number;
      if (cut) { street = cut.street; town = cut.after; }
      else {
        const last = words[words.length - 1]?.toLowerCase();
        if (words.length > 1 && last && knownTowns.has(last)) { street = words.slice(0, -1).join(" "); town = words[words.length - 1]; }
        else street = words.join(" ");
      }
    } else if (cut) {
      // "old bakehouse school lane cukney": house name, then "<word> lane", then town
      const streetWords = cut.street.split(" ");
      street = streetWords.slice(-2).join(" ");
      house = streetWords.slice(0, -2).join(" ");
      town = cut.after;
      if (!house) { house = ""; }
    } else {
      const last = words[words.length - 1]?.toLowerCase();
      if (words.length > 1 && last && knownTowns.has(last)) {
        house = words.slice(0, -1).join(" ");
        town = words[words.length - 1];
      } else {
        house = single;
      }
    }
  }

  return {
    houseNameNumber: tidyCase(house),
    street: tidyCase(street),
    town: tidyCase(town),
    postcode,
  };
}

/** Towns seen in a set of addresses (from ones that split cleanly), lower case. */
export function collectKnownTowns(addresses: string[]) {
  const towns = new Set<string>();
  for (const address of addresses) {
    const parts = splitAddress(address);
    if (parts.town && !parts.town.includes(",")) towns.add(parts.town.toLowerCase());
  }
  return towns;
}

/** Parts for a customer: stored parts if any, otherwise a best-effort split of the address line. */
export function addressPartsOf(customer: {
  address: string;
  houseNameNumber?: string | null;
  street?: string | null;
  town?: string | null;
  postcode?: string | null;
}, knownTowns?: Set<string>): AddressParts {
  if (customer.street || customer.houseNameNumber || customer.town || customer.postcode) {
    return {
      houseNameNumber: customer.houseNameNumber ?? "",
      street: customer.street ?? "",
      town: customer.town ?? "",
      postcode: customer.postcode ?? "",
    };
  }
  return splitAddress(customer.address, knownTowns);
}

/**
 * Street sort: town, then street A–Z, then house number (2 before 10, 4a after 4),
 * then named houses (no number) at the end of their street.
 */
export function compareByStreet(a: AddressParts, b: AddressParts) {
  const text = (s: string) => s.trim().toLowerCase();
  const byTown = text(a.town).localeCompare(text(b.town));
  if (byTown !== 0) return byTown;
  // Addresses with no street (just a house name) go after the named streets of that town.
  const sa = text(a.street) || "￿" + text(a.houseNameNumber);
  const sb = text(b.street) || "￿" + text(b.houseNameNumber);
  const byStreet = sa.localeCompare(sb);
  if (byStreet !== 0) return byStreet;
  const num = (s: string) => {
    const m = s.match(/(\d+)([a-z]?)/i);
    return m ? { n: Number(m[1]), suffix: m[2].toLowerCase() } : null;
  };
  const na = num(a.houseNameNumber);
  const nb = num(b.houseNameNumber);
  if (na && nb) return na.n - nb.n || na.suffix.localeCompare(nb.suffix);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  return text(a.houseNameNumber).localeCompare(text(b.houseNameNumber));
}

/** For sorting: an address with no town sorts under a fallback (usually its area's name). */
export function withTownFallback(parts: AddressParts, fallbackTown: string | null | undefined): AddressParts {
  return parts.town.trim() || !fallbackTown ? parts : { ...parts, town: fallbackTown };
}
