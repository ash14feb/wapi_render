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

/** Screen data model: every ${data.x} referenced on a screen must be declared. */
function dataModel(fields: FlowField[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    const isArray = f.kind === "checkbox";
    data[f.name] = isArray
      ? { type: "array", items: { type: "string" }, __example__: f.options?.slice(0, 1) ?? [] }
      : { type: "string", __example__: f.options?.[0] ?? f.label };
  }
  return data;
}

/** Builds static Meta Flow JSON (routing + terminal screen included). */
export function buildFlowJson(screens: FlowScreen[], completeTitle = "Thank you", completeBody = "Your response has been recorded."): Record<string, unknown> {
  const err = validateScreens(screens);
  if (err) throw new Error(err);
  interface BuiltScreen { id: string; title: string; terminal?: boolean; data: Record<string, unknown>; layout: { type: string; children: unknown[] } }
  const out: BuiltScreen[] = screens.map((s, si) => {    const children: unknown[] = [
      { type: "TextHeading", text: s.title },
      ...s.fields.map(fieldComponent),
    ];
    // Every content screen navigates forward; the terminal COMPLETE screen
    // closes the flow. (An unreachable screen fails Meta validation.)
    // Forward ALL answers so far: earlier screens via ${data.x} (they arrived
    // as this screen's data), own fields via ${form.x}. Otherwise the final
    // response_json contains only flow_token.
    const prevFields = screens.slice(0, si).flatMap((p) => p.fields);
    const payload: Record<string, string> = {};
    for (const f of prevFields) payload[f.name] = `\${data.${f.name}}`;
    for (const f of s.fields) payload[f.name] = `\${form.${f.name}}`;
    const next = si === screens.length - 1 ? "COMPLETE" : screens[si + 1].id;
    children.push({
      type: "Footer",
      label: si === screens.length - 1 ? "Submit" : "Continue",
      "on-click-action": { name: "navigate", next: { type: "screen", name: next }, payload },
    });
    // Declare incoming ${data.x} in this screen's data model (Meta requires it).
    return { id: s.id, title: s.title, data: dataModel(prevFields), layout: { type: "SingleColumnLayout", children } };
  });
  const allFields = screens.flatMap((s) => s.fields);
  const completePayload: Record<string, string> = {};
  for (const f of allFields) completePayload[f.name] = `\${data.${f.name}}`;
  out.push({
    id: "COMPLETE",
    title: completeTitle,
    terminal: true,
    data: dataModel(allFields),
    layout: { type: "SingleColumnLayout", children: [{ type: "TextHeading", text: completeTitle }, { type: "TextBody", text: completeBody }, { type: "Footer", label: "Done", "on-click-action": { name: "complete", payload: completePayload } }] },
  });
  return { version: "7.0", screens: out };
}

/** Summarizes an nfm_reply response_json for inbox display (skips flow_token). */
export function summarizeFlowResponse(responseJson: string): string {
  try {
    const obj = JSON.parse(responseJson) as Record<string, unknown>;
    const parts = Object.entries(obj)
      .filter(([k]) => k !== "flow_token")
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    return parts.length > 0 ? `Flow response — ${parts.join(" | ")}`.slice(0, 1000) : "Flow response received";
  } catch {
    return "Flow response received";
  }
}
