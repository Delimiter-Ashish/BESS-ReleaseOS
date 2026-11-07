// Compliance requirements model.
// Source: EQORE challenge brief ("Documents NFPA 855 requires for every site" table
// + approval record list) and MA code references. Recurrence intervals and change
// triggers marked "assumption" are configurable defaults — confirm with EQORE.

export type Role = "public" | "ahj" | "facility" | "eqore" | "supplier";

export const ROLE_LABEL: Record<Role, string> = {
  public: "First responders (public QR)",
  ahj: "AHJ / Fire marshal",
  facility: "Facility staff",
  eqore: "EQORE",
  supplier: "Supplier / subcontractor",
};

export type StageId =
  | "contract"
  | "intake"
  | "design"
  | "procurement"
  | "interconnection"
  | "permitting"
  | "installation"
  | "commissioning"
  | "pto"
  | "operations"
  | "decommissioning";

export const STAGES: { id: StageId; label: string; short: string }[] = [
  { id: "contract", label: "Contract & Proposal", short: "Contract" },
  { id: "intake", label: "Site Intake", short: "Intake" },
  { id: "design", label: "Design / Plan Set", short: "Design" },
  { id: "procurement", label: "Procurement", short: "Procure" },
  { id: "interconnection", label: "Interconnection", short: "IX" },
  { id: "permitting", label: "Permitting", short: "Permits" },
  { id: "installation", label: "Installation & Inspections", short: "Install" },
  { id: "commissioning", label: "Commissioning", short: "Cx" },
  { id: "pto", label: "PTO & Programs", short: "PTO" },
  { id: "operations", label: "Operations", short: "Ops" },
  { id: "decommissioning", label: "Decommissioning", short: "Decom" },
];

export const stageIndex = (s: StageId) => STAGES.findIndex((x) => x.id === s);

export type ChangeType =
  | "add_modules"
  | "inverter_replace"
  | "setpoint_change"
  | "occupancy_change"
  | "contact_change"
  | "maintenance_action";

export const CHANGE_LABEL: Record<ChangeType, string> = {
  add_modules: "Added / removed battery modules (capacity change)",
  inverter_replace: "Inverter / PCS replaced",
  setpoint_change: "Operating set points or firmware changed",
  occupancy_change: "Facility occupancy or layout changed",
  contact_change: "Emergency / service contacts changed",
  maintenance_action: "Maintenance, test, repair or training performed",
};

export interface Requirement {
  id: string;
  name: string;
  stage: StageId;
  codeRef: string;
  mustInclude: string;
  when: string;
  access: Role[];
  /** Days after which the document is overdue for refresh (assumption). */
  recurrenceDays?: number;
  /** Site changes that make this document outdated. */
  triggers: ChangeType[];
  optional?: boolean;
  /** Upstream documents. If one gets a newer approved revision, this doc needs engineering review. */
  dependsOn?: string[];
  /** Fact keys the AI should look for (helps extraction + diff). */
  keyFacts?: string[];
}

export const REQUIREMENTS: Requirement[] = [
  // ---------- Contract ----------
  {
    id: "contract",
    name: "Signed contract",
    stage: "contract",
    codeRef: "Commercial",
    mustInclude: "Parties, scope, system size, price, signatures",
    when: "At deal close",
    access: ["eqore", "facility"],
    triggers: [],
    keyFacts: ["rating.power_kw", "rating.energy_kwh", "doc.date"],
  },
  {
    id: "proposal",
    name: "Proposal / deal summary",
    stage: "contract",
    codeRef: "Commercial",
    mustInclude: "Sizing, savings model, incentives, schedule",
    when: "Before contract",
    access: ["eqore", "facility"],
    triggers: [],
  },
  // ---------- Site intake ----------
  {
    id: "utility_bill",
    name: "Utility bill (12 months)",
    stage: "intake",
    codeRef: "Site intake",
    mustInclude: "Account, service address, rate, demand history",
    when: "Site intake",
    access: ["eqore"],
    triggers: [],
    keyFacts: ["utility.account", "site.address"],
  },
  {
    id: "site_photos",
    name: "Site photos (meter, transformer, MDP, pole)",
    stage: "intake",
    codeRef: "Site intake",
    mustInclude: "Revenue meter + serial, transformer nameplate, main distribution panel, utility pole number",
    when: "Site intake",
    access: ["eqore", "supplier"],
    triggers: [],
    keyFacts: ["meter.serial", "pole.number"],
  },
  {
    id: "property_record",
    name: "Property / parcel record",
    stage: "intake",
    codeRef: "Site intake",
    mustInclude: "Parcel map, owner, setbacks",
    when: "Site intake",
    access: ["eqore"],
    triggers: [],
  },
  // ---------- Design ----------
  {
    id: "plan_set",
    name: "Engineered plan set (stamped)",
    stage: "design",
    codeRef: "780 CMR / 527 CMR 12.00 / NFPA 855",
    mustInclude: "Site plan, line diagrams, equipment, calculations, required signage, fire resistance & suppression, NFPA 855 compliance sheet, PE stamp",
    when: "Before permit submission; re-issued on every design change",
    access: ["eqore", "ahj", "facility", "supplier"],
    triggers: [],
    dependsOn: ["battery_datasheet", "inverter_datasheet", "switchgear_datasheet"],
    keyFacts: ["revision.label", "rating.power_kw", "rating.energy_kwh", "equipment.model", "doc.date"],
  },
  // ---------- Procurement (supplier documents) ----------
  {
    id: "battery_datasheet",
    name: "Battery (BESS) datasheet",
    stage: "procurement",
    codeRef: "NFPA 855 §4.1 / UL 9540",
    mustInclude: "Model, energy kWh, power kW, chemistry, enclosure rating",
    when: "From supplier; re-check on every revision",
    access: ["eqore", "ahj", "supplier"],
    triggers: [],
    keyFacts: ["equipment.model", "rating.energy_kwh", "rating.power_kw", "chemistry"],
  },
  {
    id: "inverter_datasheet",
    name: "Inverter / PCS datasheet",
    stage: "procurement",
    codeRef: "NEC 706 / UL 1741 SB",
    mustInclude: "Model, AC rating kW, voltage, UL 1741 SB listing",
    when: "From supplier",
    access: ["eqore", "ahj", "supplier"],
    triggers: [],
    keyFacts: ["equipment.model", "rating.power_kw", "rating.voltage_v"],
  },
  {
    id: "switchgear_datasheet",
    name: "Switchgear / AC disconnect datasheet",
    stage: "procurement",
    codeRef: "NEC 706 / NEC 240",
    mustInclude: "Model, rated current A, voltage, interrupting rating, enclosure",
    when: "From supplier",
    access: ["eqore", "ahj", "supplier"],
    triggers: [],
    keyFacts: ["equipment.model", "rating.current_a", "rating.voltage_v", "rating.interrupting_ka"],
  },
  {
    id: "ul9540_listing",
    name: "UL 9540 system listing",
    stage: "procurement",
    codeRef: "NFPA 855 §4.1.2 / UL 9540",
    mustInclude: "Listed system model, certifier, file number",
    when: "From supplier",
    access: ["eqore", "ahj", "supplier"],
    triggers: [],
  },
  {
    id: "ul9540a_report",
    name: "UL 9540A fire test report",
    stage: "procurement",
    codeRef: "NFPA 855 §9.1.5 / UL 9540A",
    mustInclude: "Cell/module/unit test results, gas composition, propagation",
    when: "From supplier; needed for AHJ fire review",
    access: ["eqore", "ahj", "supplier"],
    triggers: [],
  },
  // ---------- Interconnection ----------
  {
    id: "ix_application",
    name: "Interconnection application",
    stage: "interconnection",
    codeRef: "Utility interconnection tariff (National Grid / Eversource / PG&E Rule 21)",
    mustInclude: "One-line diagram, equipment specs, export/non-export mode, site info",
    when: "Submitted before design is finalized",
    access: ["eqore", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "ix_approval",
    name: "Interconnection approval / agreement",
    stage: "interconnection",
    codeRef: "Utility interconnection tariff",
    mustInclude: "Approved capacity, operating limits, utility conditions",
    when: "Before construction",
    access: ["eqore", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  // ---------- Permitting ----------
  {
    id: "permit_building",
    name: "Building permit",
    stage: "permitting",
    codeRef: "780 CMR (MA State Building Code, 10th ed.)",
    mustInclude: "Permit number, scope, AHJ, approved plan set",
    when: "Before construction",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules"],
  },
  {
    id: "permit_electrical",
    name: "Electrical permit",
    stage: "permitting",
    codeRef: "527 CMR 12.00 / NEC Art. 706",
    mustInclude: "Permit number, licensed electrician, scope",
    when: "Before construction",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "permit_fire",
    name: "Fire permit (ESS)",
    stage: "permitting",
    codeRef: "527 CMR 1.00 / NFPA 855 / IFC 1207",
    mustInclude: "ESS size & chemistry, spacing, detection/suppression approach",
    when: "Before construction",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "occupancy_change"],
  },
  // ---------- Installation ----------
  {
    id: "insp_electrical",
    name: "Electrical inspection sign-off",
    stage: "installation",
    codeRef: "527 CMR 12.00",
    mustInclude: "Inspector, date, pass/fail, comments",
    when: "After rough-in and final",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "insp_building",
    name: "Building inspection sign-off",
    stage: "installation",
    codeRef: "780 CMR",
    mustInclude: "Inspector, date, pass/fail",
    when: "Final inspection",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules"],
  },
  {
    id: "signage",
    name: "Signage, hazard markings & system labels",
    stage: "installation",
    codeRef: "NFPA 855 §7.1.3 / NEC 706",
    mustInclude: "Hazard markings, disconnect & system labels, photos of installed labels",
    when: "Before final inspection; update when equipment changes",
    access: ["eqore", "ahj", "facility", "public"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "sds",
    name: "Safety data sheet (SDS), posted at disconnect",
    stage: "procurement",
    codeRef: "NFPA 855 §7.1.3",
    mustInclude: "SDS for installed battery chemistry, posted within sight of disconnect",
    when: "Before operation; update when modules change",
    access: ["eqore", "ahj", "facility", "public"],
    triggers: ["add_modules"],
  },
  // ---------- Commissioning ----------
  {
    id: "cx_plan",
    name: "Commissioning plan",
    stage: "commissioning",
    codeRef: "NFPA 855 §6.1",
    mustInclude: "Process & roles, test procedures for detection/suppression/ventilation, checklists, training",
    when: "Before commissioning",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "cx_report",
    name: "Commissioning report",
    stage: "commissioning",
    codeRef: "NFPA 855 §6.1",
    mustInclude: "Test results, issues found & resolutions, as-built plans",
    when: "To owner & AHJ before final inspection; added to O&M manual",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "insp_fire",
    name: "Fire inspection sign-off",
    stage: "commissioning",
    codeRef: "527 CMR 1.00 / NFPA 855",
    mustInclude: "Fire dept inspector, date, pass/fail",
    when: "Final inspection (after commissioning report)",
    access: ["eqore", "ahj", "facility"],
    triggers: ["add_modules", "occupancy_change"],
  },
  // ---------- PTO ----------
  {
    id: "pto",
    name: "Utility permission to operate (PTO)",
    stage: "pto",
    codeRef: "Utility interconnection tariff",
    mustInclude: "PTO date, utility reference number, operating conditions",
    when: "Before energizing for normal operation",
    access: ["eqore", "facility"],
    triggers: ["add_modules", "inverter_replace"],
  },
  {
    id: "program_enrollment",
    name: "Program enrollment (ConnectedSolutions / Clean Peak)",
    stage: "pto",
    codeRef: "ConnectedSolutions / 225 CMR 21.00 (Clean Peak)",
    mustInclude: "Enrollment confirmation, enrolled capacity",
    when: "After PTO; update when capacity changes",
    access: ["eqore", "facility"],
    triggers: ["add_modules"],
    optional: true,
  },
  // ---------- Operations ----------
  {
    id: "om_manual",
    name: "O&M manual",
    stage: "operations",
    codeRef: "NFPA 855 §4.1.2.3, §6.3, §7.1",
    mustInclude: "System size & components, manufacturer manuals, service contacts, set points, startup/safety procedures, re-permit triggers, maintenance schedule",
    when: "Before operation; update on any system change",
    access: ["eqore", "ahj", "facility", "public"],
    triggers: ["add_modules", "inverter_replace", "setpoint_change", "contact_change"],
  },
  {
    id: "ops_record",
    name: "Operations record / service log",
    stage: "operations",
    codeRef: "NFPA 855 §7.1.6 (may be kept electronically, §7.1.6.2)",
    mustInclude: "Action, date, who, result for every maintenance, test, repair, training",
    when: "Updated after every maintenance action",
    access: ["eqore", "ahj", "facility", "public"],
    recurrenceDays: 365, // assumption: at least annual maintenance entry
    triggers: ["maintenance_action", "setpoint_change"],
  },
  {
    id: "eop",
    name: "Emergency operations plan",
    stage: "operations",
    codeRef: "NFPA 855 §4.1.3.2.1",
    mustInclude: "Safe shutdown & isolation, BMS alarm response, fire/explosion/release procedures, damaged equipment, drill schedule",
    when: "Kept on site; update when emergency-response conditions change",
    access: ["eqore", "facility"],
    recurrenceDays: 365, // assumption: annual review
    triggers: ["add_modules", "inverter_replace", "occupancy_change", "contact_change"],
  },
  {
    id: "training_drill",
    name: "Training & drill records",
    stage: "operations",
    codeRef: "NFPA 855 §4.1.3.2.1, §7.1",
    mustInclude: "Attendees, date, drill scenario, outcome",
    when: "Per drill schedule in EOP",
    access: ["eqore", "facility"],
    recurrenceDays: 365, // assumption: annual drill
    triggers: [],
  },
  // ---------- Decommissioning ----------
  {
    id: "decom_plan",
    name: "Decommissioning plan",
    stage: "decommissioning",
    codeRef: "NFPA 855 §8.1–8.3",
    mustInclude: "Process & roles, as-built/as-maintained plans, schedule, checklists, protection of adjacent systems",
    when: "Before decommissioning; AHJ notified beforehand",
    access: ["eqore", "ahj", "facility"],
    triggers: [],
  },
  {
    id: "decom_ahj_notice",
    name: "AHJ notification of decommissioning",
    stage: "decommissioning",
    codeRef: "NFPA 855 §8.1–8.3",
    mustInclude: "Notice to AHJ with planned dates and scope",
    when: "Before decommissioning starts",
    access: ["eqore", "ahj", "facility"],
    triggers: [],
  },
  {
    id: "decom_report",
    name: "Decommissioning report",
    stage: "decommissioning",
    codeRef: "NFPA 855 §8.1–8.3",
    mustInclude: "Activities completed, issues & resolutions",
    when: "After decommissioning",
    access: ["eqore", "ahj", "facility"],
    triggers: [],
  },
];

export const REQ_BY_ID = Object.fromEntries(REQUIREMENTS.map((r) => [r.id, r])) as Record<string, Requirement>;

// ---------- Submission package templates ----------
// ILLUSTRATIVE until EQORE confirms the real checklists (say so in the demo).
export interface PackageTemplate {
  id: string;
  name: string;
  audience: string;
  required: string[]; // requirement ids
  basis: string;
}

export const PACKAGE_TEMPLATES: PackageTemplate[] = [
  {
    id: "ahj_permit",
    name: "AHJ permit package",
    audience: "Town building & fire department",
    required: ["plan_set", "battery_datasheet", "inverter_datasheet", "switchgear_datasheet", "ul9540_listing", "ul9540a_report", "sds"],
    basis: "Mirrors the sample plan set (site plan, line diagrams, equipment, signage ESS-18, fire ESS-19, NFPA 855 ESS-20) + supplier cut sheets and listings",
  },
  {
    id: "interconnection",
    name: "Utility interconnection package",
    audience: "Utility (Eversource / National Grid / PG&E)",
    required: ["ix_application", "plan_set", "inverter_datasheet", "switchgear_datasheet", "utility_bill", "site_photos"],
    basis: "Interconnection tariff application requirements",
  },
  {
    id: "closeout",
    name: "Commissioning & closeout package",
    audience: "AHJ + facility (NFPA 855 §6.1)",
    required: ["cx_report", "om_manual", "eop", "signage", "sds", "insp_electrical", "insp_building", "insp_fire"],
    basis: "NFPA 855 documents table in the EQORE brief",
  },
];
export const TEMPLATE_BY_ID = Object.fromEntries(PACKAGE_TEMPLATES.map((t) => [t.id, t])) as Record<string, PackageTemplate>;
