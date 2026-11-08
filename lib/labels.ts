// Presentation labels (client-safe). Backend ids, enum values and template names are NOT changed —
// these only control what people read on screen.

export const PACKAGE_LABEL: Record<string, string> = {
  ahj_permit: "Town Permit Application",
  interconnection: "Utility Grid Connection",
  closeout: "Testing & Handover Documents",
};
export const PACKAGE_BLURB: Record<string, string> = {
  ahj_permit: "What the town building and fire departments need to review the permit application.",
  interconnection: "What the utility needs to approve connecting the battery to the grid.",
  closeout: "Test results and handover records collected after installation.",
};
export const pkgLabel = (templateId: string, fallback?: string) => PACKAGE_LABEL[templateId] ?? fallback ?? templateId;

export const SECTION = {
  lifecycle: "Project Roadmap",
  packages: "Document Packages & Approvals",
  audit: "Activity & Approval History",
  qr: "Emergency Access / Site QR",
} as const;

/** Short, plain-language definitions shown as tooltips. */
export const GLOSSARY: Record<string, string> = {
  kW: "Kilowatts — how much power the battery can deliver at one moment.",
  kWh: "Kilowatt-hours — how much energy the battery can store.",
  AHJ: "Authority Having Jurisdiction — the local building and fire officials who approve the installation.",
  PTO: "Permission to Operate — the utility's written approval to switch the system on.",
  Interconnection: "The utility's review and approval for connecting the system to the electric grid.",
  Commissioning: "Testing the installed system to prove it works as designed before handover.",
  "Plan set": "The stamped engineering drawings for the installation.",
  Revision: "A numbered version of a document (Rev A, Rev B…). Only engineer-approved revisions go into packages.",
  BESS: "Battery Energy Storage System.",
  LFP: "Lithium iron phosphate — a battery chemistry with good thermal stability.",
  "UL 9540A": "A fire-safety test method for battery systems that AHJs commonly ask for.",
};

export const STATE_NAME: Record<string, string> = { MA: "Massachusetts", CA: "California" };
