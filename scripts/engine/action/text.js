const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['â€™]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseActionText(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, " ");
  const numbers = [...text.matchAll(/\b(?:[123]|one|two|three)\b/g)]
    .map((match) => WORD_NUMBERS[match[0]] ?? Number(match[0]))
    .filter((number) => Number.isFinite(number) && number >= 0 && number <= 3);
  if (!numbers.length) return null;
  return Math.min(...numbers);
}
