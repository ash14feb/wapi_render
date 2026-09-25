/** Count distinct positional variables ({{1}}, {{2}}, …) and return the highest index. */
export function countTemplateVars(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/** Render preview by substituting {{n}} with values[n-1]; unknown kept as-is. */
export function renderTemplatePreview(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const v = values[Number(n) - 1];
    return v !== undefined && v !== "" ? v : match;
  });
}

/** Extract BODY text from stored components JSON (creation shape: UPPERCASE types). */
export function extractBodyText(componentsJson: string | null): string | null {
  if (!componentsJson) return null;
  try {
    const arr = JSON.parse(componentsJson) as Array<{ type?: string; text?: string }>;
    if (!Array.isArray(arr)) return null;
    const body = arr.find((c) => c.type === "BODY" || c.type === "body");
    return typeof body?.text === "string" ? body.text : null;
  } catch {
    return null;
  }
}

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

/** HEADER format from stored components JSON, or null when the template has no header. */
export function extractHeaderFormat(componentsJson: string | null): HeaderFormat | null {
  if (!componentsJson) return null;
  try {
    const arr = JSON.parse(componentsJson) as Array<{ type?: string; format?: string }>;
    if (!Array.isArray(arr)) return null;
    const h = arr.find((c) => c.type === "HEADER" || c.type === "header");
    if (!h) return null;
    const f = (h.format ?? "TEXT").toUpperCase();
    return f === "IMAGE" || f === "VIDEO" || f === "DOCUMENT" ? f : "TEXT";
  } catch {
    return null;
  }
}
