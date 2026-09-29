/** Pure text helpers, safe on both server and phone. */

/**
 * UK mobile numbers only (landlines can't get texts). Returns 447xxxxxxxxx or null.
 * Accepts "07811 213929", "+44 7811 213929", "447811213929", and numbers inside other text.
 */
export function ukMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.replace(/[\s\-().]/g, "").match(/(?:\+?44|0)7\d{9}/);
  if (!match) return null;
  return "44" + match[0].replace(/^\+?44|^0/, "");
}

const PLACE_WORDS = /\b(road|rd|street|st|lane|ln|close|avenue|ave|drive|way|court|view|cottage|cottages|house|bungalow|farm|hall|pub|barn|lodge|mill|croft|nook|green|hill|place|terrace|crescent|grove)\b/i;

/**
 * The name to greet someone by. "John Smith" -> "John", "Mrs Smith" -> "Mrs Smith",
 * "meadowside bungalow (alan bellingham)" -> "Alan". When the "name" is really an
 * address or house name (common in imported rounds) -> "there", so texts read "Hi there".
 */
export function greetingName(name: string, address = "") {
  const inBrackets = name.match(/\(([^)]*)\)/)?.[1]?.trim();
  if (inBrackets && /^[a-z' -]+$/i.test(inBrackets) && inBrackets.split(/\s+/).length <= 3) {
    return greetingName(inBrackets);
  }
  const clean = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const words = clean.split(/\s+/);
  if (!words[0] || /\d/.test(clean) || PLACE_WORDS.test(clean) || /^the$/i.test(words[0])) return "there";
  if (address && clean.toLowerCase() === address.trim().toLowerCase()) return "there";
  if (/^(mr|mrs|miss|ms|dr)\.?$/i.test(words[0]) && words[1]) {
    return `${words[0][0].toUpperCase()}${words[0].slice(1).toLowerCase()} ${words[words.length - 1][0].toUpperCase()}${words[words.length - 1].slice(1)}`;
  }
  if (words.length > 3) return "there";
  return words[0][0].toUpperCase() + words[0].slice(1);
}

export function money(value: number) {
  return `£${value.toFixed(2)}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function textDate(value: Date | string) {
  const d = new Date(value);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

