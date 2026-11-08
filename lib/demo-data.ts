// CSV-backed demo dataset (server-only). Read ONCE at seed time; the in-memory store is the source of truth afterwards.
// See data/demo/README.md. All projects except S-1001 are fictional; S-1001 follows the EQORE sample plan-set structure.
import { readFileSync } from "fs";
import { join } from "path";
import { REQ_BY_ID, type StageId } from "./requirements";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const DIR = () => join(process.cwd(), "data", "demo");
const load = (name: string) => {
  try {
    return parseCsv(readFileSync(join(DIR(), name), "utf8"));
  } catch {
    throw new Error(`Missing data/demo/${name} (demo seed dataset)`);
  }
};

export type Provenance = "eqore_reference_structure" | "synthetic";
export interface ProjectRow {
  id: string; name: string; customer: string; address: string; city: string; state: "MA" | "CA"; utility: string; ahj: string;
  stage: StageId; chemistry: string; powerKw: number; energyKwh: number; vendor: string; inverter?: string;
  location: string; disconnectLocation: string; installDaysAgo?: number; provenance: Provenance;
}
export interface DocumentRow { projectId: string; requirementId: string; rev: string; status: "approved" | "in_review"; daysAgo: number; source: string; uploadedBy: string; file?: string; note?: string }
export interface FactRow { projectId: string; requirementId: string; rev: string; key: string; label: string; value: string; unit?: string; evidence?: string; page?: number }
export interface PartyRow { projectId: string; role: string; name: string; organization: string; phone: string; responsibleFor: string[] }

const num = (s: string) => (s === "" ? undefined : Number(s));

export function loadProjects(): ProjectRow[] {
  return load("projects.csv").map((r) => ({
    id: r.id, name: r.name, customer: r.customer, address: r.address, city: r.city, state: r.state as "MA" | "CA", utility: r.utility, ahj: r.ahj,
    stage: r.stage as StageId, chemistry: r.chemistry, powerKw: Number(r.power_kw), energyKwh: Number(r.energy_kwh), vendor: r.vendor,
    inverter: r.inverter || undefined, location: r.location, disconnectLocation: r.disconnect_location, installDaysAgo: num(r.install_days_ago),
    provenance: (r.provenance || "synthetic") as Provenance,
  }));
}
export function loadDocuments(): DocumentRow[] {
  return load("documents.csv").map((r) => {
    if (!REQ_BY_ID[r.requirement_id]) throw new Error(`documents.csv: unknown requirement ${r.requirement_id}`);
    return { projectId: r.project_id, requirementId: r.requirement_id, rev: r.rev, status: r.status as DocumentRow["status"], daysAgo: Number(r.days_ago), source: r.source, uploadedBy: r.uploaded_by, file: r.file || undefined, note: r.note || undefined };
  });
}
export function loadFacts(): FactRow[] {
  return load("facts.csv").map((r) => ({ projectId: r.project_id, requirementId: r.requirement_id, rev: r.rev, key: r.key, label: r.label, value: r.value, unit: r.unit || undefined, evidence: r.evidence || undefined, page: num(r.page) }));
}

let partiesCache: PartyRow[] | undefined;
export function loadParties(): PartyRow[] {
  partiesCache ??= load("parties.csv").map((r) => ({ projectId: r.project_id, role: r.role, name: r.name, organization: r.organization, phone: r.phone, responsibleFor: r.responsible_for.split(";").map((x) => x.trim()).filter(Boolean) }));
  return partiesCache;
}
export const partiesFor = (projectId: string) => loadParties().filter((p) => p.projectId === "*" || p.projectId === projectId);

/** Responsible party for a requirement: explicit requirement id first, then its lifecycle stage, then the PM. */
export function ownerFor(projectId: string, requirementId: string): PartyRow {
  const ps = partiesFor(projectId);
  const stage = REQ_BY_ID[requirementId]?.stage;
  return ps.find((p) => p.responsibleFor.includes(requirementId)) ?? ps.find((p) => !!stage && p.responsibleFor.includes(stage)) ?? ps.find((p) => p.role === "Project manager")!;
}

const projectProvenance = new Map<string, Provenance>();
export const provenanceOf = (projectId: string): Provenance => {
  if (!projectProvenance.size) for (const p of loadProjects()) projectProvenance.set(p.id, p.provenance);
  return projectProvenance.get(projectId) ?? "synthetic";
};
export const customerOf = (projectId: string) => loadProjects().find((p) => p.id === projectId)?.customer;
