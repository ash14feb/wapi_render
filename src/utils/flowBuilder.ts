export type FlowFieldKind = "text" | "textarea" | "number" | "email" | "dropdown" | "checkbox" | "radio" | "date";

export interface FlowField {
  kind: FlowFieldKind;
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface FlowScreen {
  id: string;
  title: string;
  fields: FlowField[];
}

const ID_RE = /^[A-Za-z][A-Za-z_]{0,63}$/;

/** A, B, … Z, AA, AB … — Meta ids allow alphabets + underscores only (no digits). */
export function alphaSeq(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function validateScreens(screens: FlowScreen[]): string | null {
  if (!Array.isArray(screens) || screens.length === 0 || screens.length > 10) return "Provide 1-10 screens";
  const seen = new Set<string>();
  for (const s of screens) {
    if (!ID_RE.test(s.id ?? "")) return `Invalid screen id: ${s.id}`;
    if (seen.has(s.id)) return `Duplicate screen id: ${s.id}`;
    seen.add(s.id);
    if (!s.title?.trim()) return `Screen ${s.id} needs a title`;
    const names = new Set<string>();
    for (const f of s.fields ?? []) {
      if (!ID_RE.test(f.name ?? "")) return `Invalid field name: ${f.name} (screen ${s.id})`;
      if (names.has(f.name)) return `Duplicate field name: ${f.name} (screen ${s.id})`;
      names.add(f.name);
      if (!f.label?.trim()) return `Field ${f.name} needs a label`;
      if ((f.kind === "dropdown" || f.kind === "checkbox" || f.kind === "radio") && (!f.options || f.options.length === 0)) {
        return `Field ${f.name} needs at least one option`;
      }
    }
  }
  return null;
}

function staticOptions(options: string[]) {
  return { type: "Static", options: options.map((t, i) => ({ id: `opt_${alphaSeq(i).toLowerCase()}`, title: t })) };
}

function fieldComponent(f: FlowField): Record<string, unknown> {
  const base = { label: f.label, name: f.name, required: !!f.required };
  switch (f.kind) {
    case "textarea":
      return { type: "TextArea", ...base };
    case "number":
      return { type: "TextInput", ...base, "input-type": "number" };
    case "email":
      return { type: "TextInput", ...base, "input-type": "email" };
    case "dropdown":
      return { type: "Dropdown", ...base, "data-source": staticOptions(f.options ?? []) };
    case "checkbox":
      return { type: "CheckboxGroup", ...base, "data-source": staticOptions(f.options ?? []) };
    case "radio":
      return { type: "RadioButtonsGroup", ...base, "data-source": staticOptions(f.options ?? []) };
    case "date":
      return { type: "DatePicker", ...base };
    case "text":
    default:
      return { type: "TextInput", ...base, "input-type": "text" };
  }
}

/** Builds static Meta Flow JSON (routing + terminal screen included). */
export function buildFlowJson(screens: FlowScreen[], completeTitle = "Thank you", completeBody = "Your response has been recorded."): Record<string, unknown> {
  const err = validateScreens(screens);
  if (err) throw new Error(err);
  interface BuiltScreen { id: string; title: string; terminal?: boolean; data: Record<string, unknown>; layout: { type: string; children: unknown[] } }
  const out: BuiltScreen[] = screens.map((s, si) => {
    const children: unknown[] = [
      { type: "TextHeading", text: s.title },
      ...s.fields.map(fieldComponent),
    ];
    // Every content screen navigates forward; the terminal COMPLETE screen
    // closes the flow. (An unreachable screen fails Meta validation.)
    const next = si === screens.length - 1 ? "COMPLETE" : screens[si + 1].id;
    children.push({
      type: "Footer",
      label: si === screens.length - 1 ? "Submit" : "Continue",
      "on-click-action": { name: "navigate", next: { type: "screen", name: next }, payload: Object.fromEntries(s.fields.map((f) => [f.name, `\${form.${f.name}}`])) },
    });
    return { id: s.id, title: s.title, data: {}, layout: { type: "SingleColumnLayout", children } };
  });
  out.push({
    id: "COMPLETE",
    title: completeTitle,
    terminal: true,
    data: {},
    layout: { type: "SingleColumnLayout", children: [{ type: "TextHeading", text: completeTitle }, { type: "TextBody", text: completeBody }, { type: "Footer", label: "Done", "on-click-action": { name: "complete", payload: {} } }] },
  });
  return { version: "7.0", screens: out };
}

/** Summarizes an nfm_reply response_json for inbox display. */
export function summarizeFlowResponse(responseJson: string): string {
  try {
    const obj = JSON.parse(responseJson) as Record<string, unknown>;
    const parts = Object.entries(obj).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    return `Flow response — ${parts.join(" | ")}`.slice(0, 1000);
  } catch {
    return "Flow response received";
  }
}
