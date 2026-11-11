/** Count distinct positional variables ({{1}}, {{2}}, …) and return the highest index. */
export function countTemplateVars(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * True when the body ends with a {{n}} variable. Meta rejects bodies that
 * terminate on a variable ("Invalid parameter"), so text must follow it.
 */
export function endsWithTemplateVar(text: string): boolean {
  return /\{\{\d+\}\}\s*$/.test(text);
}

export const TEMPLATE_LIMITS = {
  nameMax: 512,
  bodyMax: 1024,
  headerTextMax: 60,
  footerMax: 60,
} as const;

/** NBSP, zero-width and other Unicode spaces that break Meta's variable parser. */
const IRREGULAR_SPACE = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/;

export interface TemplateBodyIssue {
  field: "bodyText" | "headerText" | "footerText" | "examples" | "name";
  message: string;
}

function uniqueVarIndexes(text: string): number[] {
  return Array.from(new Set(Array.from(text.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])))).sort((a, b) => a - b);
}

/**
 * Meta's pre-send rules for template bodies/headers/footers. Returns every
 * violation so callers can report them all at once, before calling Meta.
 */
export function validateTemplateContent(input: {
  name: string;
  bodyText?: string;
  headerText?: string;
  footerText?: string;
  examples?: string[];
}): TemplateBodyIssue[] {
  const issues: TemplateBodyIssue[] = [];
  const body = input.bodyText ?? "";

  if (!/^[a-z0-9_]+$/.test(input.name)) {
    issues.push({ field: "name", message: "Name must be lowercase letters, digits and underscores only" });
  }
  if (input.name.length > TEMPLATE_LIMITS.nameMax) {
    issues.push({ field: "name", message: `Name exceeds ${TEMPLATE_LIMITS.nameMax} characters` });
  }
  if (body.length > TEMPLATE_LIMITS.bodyMax) {
    issues.push({ field: "bodyText", message: `Body exceeds ${TEMPLATE_LIMITS.bodyMax} characters` });
  }

  for (const field of ["bodyText", "headerText", "footerText"] as const) {
    const text = input[field];
    if (text && IRREGULAR_SPACE.test(text)) {
      issues.push({ field, message: "Contains non-breaking or irregular whitespace next to a variable or in the text" });
    }
  }

  const trimmed = body.trim();
  if (trimmed) {
    if (/^\{\{\d+\}\}/.test(trimmed)) {
      issues.push({ field: "bodyText", message: "Body cannot start with a variable; add static text before it" });
    }
    const lastVar = trimmed.match(/^[\s\S]*\{\{\d+\}\}/);
    if (lastVar && !/[\p{L}\p{N}]/u.test(trimmed.slice(lastVar[0].length))) {
      issues.push({ field: "bodyText", message: "Body cannot end with a variable; add static text after it" });
    }

    body.split(/\r?\n/).forEach((line, i) => {
      if (/\{\{\d+\}\}/.test(line) && line.replace(/\{\{\d+\}\}/g, "").trim() === "") {
        issues.push({ field: "bodyText", message: `Line ${i + 1} contains only a variable; add surrounding text` });
      }
    });

    if (/\{\{\d+\}\}(?=[^\s.,;:!?)\]}'"-])/.test(trimmed) || /[^\s.,;:!?(\[{'"-]\{\{\d+\}\}/.test(trimmed)) {
      issues.push({
        field: "bodyText",
        message: "Variables must be separated from adjacent text by a space or punctuation",
      });
    }

    const indexes = uniqueVarIndexes(body);
    const expected = Array.from({ length: indexes.length }, (_, i) => i + 1);
    if (indexes.some((n, i) => n !== expected[i])) {
      issues.push({
        field: "bodyText",
        message: `Variables must be numbered sequentially from {{1}} without gaps (found ${indexes.map((n) => `{{${n}}}`).join(", ")})`,
      });
    }

    const examples = input.examples ?? [];
    if (indexes.length > 0) {
      if (examples.length !== indexes.length) {
        issues.push({
          field: "examples",
          message: `Body has ${indexes.length} variable(s); provide exactly ${indexes.length} example value(s)`,
        });
      } else if (examples.some((e) => typeof e !== "string" || e.trim() === "")) {
        issues.push({ field: "examples", message: "Example values cannot be empty" });
      }
    }
  }

  if (input.headerText) {
    if (/\{\{\d+\}\}/.test(input.headerText)) {
      issues.push({ field: "headerText", message: "Header text cannot contain variables" });
    }
    if (input.headerText.length > TEMPLATE_LIMITS.headerTextMax) {
      issues.push({ field: "headerText", message: `Header text exceeds ${TEMPLATE_LIMITS.headerTextMax} characters` });
    }
  }

  if (input.footerText) {
    if (/\{\{\d+\}\}|\{\{/.test(input.footerText)) {
      issues.push({ field: "footerText", message: "Footer text cannot contain variables" });
    }
    if (input.footerText.length > TEMPLATE_LIMITS.footerMax) {
      issues.push({ field: "footerText", message: `Footer exceeds ${TEMPLATE_LIMITS.footerMax} characters` });
    }
  }

  return issues;
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
