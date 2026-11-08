// Generates ADDITIONAL synthetic demo documents for the Project Assurance UI (sample-docs/demo/).
// Fictional manufacturers and ratings. Deterministic output (fixed metadata dates) so seeded hashes are stable.
// Does NOT touch the original fixtures written by scripts/generate-sample-pdfs.mjs.
// Usage: node scripts/generate-demo-pdfs.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "sample-docs");
const demo = join(root, "demo");
mkdirSync(demo, { recursive: true });
const FIXED = new Date("2026-01-01T00:00:00Z");

async function makePdf(dir, fileName, title, pages) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("SYNTHETIC SAMPLE");
  doc.setProducer("BESS ReleaseOS sample generator");
  doc.setCreator("BESS ReleaseOS");
  doc.setCreationDate(FIXED);
  doc.setModificationDate(FIXED);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  pages.forEach((lines, i) => {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 36, y: 748, width: 540, height: 22, color: rgb(0.85, 0.1, 0.1) });
    page.drawText("SYNTHETIC SAMPLE - FICTIONAL MANUFACTURER - NOT FOR CONSTRUCTION", { x: 44, y: 755, size: 10, font: bold, color: rgb(1, 1, 1) });
    let y = 715;
    for (const line of lines) {
      const isHeading = line.startsWith("# ");
      const text = isHeading ? line.slice(2) : line;
      page.drawText(text, { x: 54, y, size: isHeading ? 15 : 11, font: isHeading ? bold : font, color: rgb(0.1, 0.1, 0.15) });
      y -= isHeading ? 26 : 18;
    }
    page.drawText(`${title} - page ${i + 1} of ${pages.length}`, { x: 54, y: 40, size: 8, font, color: rgb(0.4, 0.4, 0.45) });
  });
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(join(dir, fileName), bytes);
  console.log(`wrote ${dir === root ? "sample-docs" : "sample-docs/demo"}/${fileName} (${bytes.length} bytes)`);
}

// ---- Hero scenario: Century Tywood switchgear Rev B, 400 A -> 600 A (same manufacturer/model as seeded Rev A) ----
await makePdf(root, "SYNTHETIC_Switchgear_Spec_RevB_600A.pdf", "NPS-SG-4000 Switchgear Specification Rev B", [
  [
    "# AC Switchgear / BESS Disconnect - Product Specification",
    "Manufacturer: Northbridge Power Systems (fictional)",
    "Document No.: NPS-SG-4000-SPEC",
    "Revision: B",
    "Date: 2026-11-06",
    "Project: Century Tywood J3 Corp - 250 kW / 760 kWh BESS (synthetic)",
    "",
    "# Revision history",
    "Rev A  2026-07-15  Initial release",
    "Rev B  2026-11-06  Rated current increased to 600 A per updated inverter configuration",
    "",
    "Electrical ratings are listed on page 2.",
  ],
  [
    "# Electrical Ratings",
    "Manufacturer: Northbridge Power Systems",
    "Model: NSG-4000",
    "Rated voltage: 480 VAC, 3-phase, 4-wire",
    "Rated continuous current: 600 A",
    "Interrupting rating: 65 kA",
    "Frequency: 60 Hz",
    "Enclosure: NEMA 3R",
    "Quantity: 1",
    "Listing standard: UL 891",
    "",
    "Ratings are synthetic and for software demonstration only.",
  ],
]);

// ---- Seeded review-queue documents for the other fictional projects (sample-docs/demo/) ----
await makePdf(demo, "SYNTHETIC_Granite_Inverter_Datasheet_RevA.pdf", "Granite Precision - PCS Datasheet Rev A", [
  [
    "# Power Conversion System - Inverter Datasheet",
    "Manufacturer: Corvane Power Electronics (fictional)",
    "Document No.: CPE-PCS-250-DS",
    "Revision: A",
    "Date: 2026-10-30",
    "Project: Granite Precision Machining - 250 kW / 500 kWh BESS (synthetic)",
    "",
    "# Ratings",
    "Model: CPE-250X",
    "Rated power: 250 kW",
    "Rated voltage: 480 VAC, 3-phase",
    "Frequency: 60 Hz",
    "Listing standard: UL 1741",
    "Quantity: 1",
  ],
]);

await makePdf(demo, "SYNTHETIC_Granite_Plan_Set_RevA.pdf", "Granite Precision - Engineered Plan Set Rev A", [
  [
    "# Engineered Plan Set - Granite Precision Machining (synthetic)",
    "Engineer of record: L. Moreno, PE (fictional)",
    "Revision: A",
    "Date: 2026-11-01",
    "AC System Size: 250 kW",
    "DC System Size: 500 kWh",
    "",
    "# Revision block",
    "A  2026-11-01  Issued for internal engineering review",
    "",
    "# Sheet index",
    "ESS-1.0 Cover  ESS-2.0 Site plan  ESS-13.0 Single-line diagram",
  ],
]);

await makePdf(demo, "SYNTHETIC_Harbor_Battery_Datasheet_RevB.pdf", "Harbor Food Processing - BESS Datasheet Rev B", [
  [
    "# Battery Energy Storage System - Datasheet",
    "Manufacturer: Lumora Energy Storage (fictional)",
    "Document No.: LES-E1000-DS",
    "Revision: B",
    "Date: 2026-11-03",
    "Project: Harbor Food Processing (synthetic)",
    "",
    "# Ratings",
    "Model: LES-E1000",
    "Chemistry: LFP (lithium iron phosphate)",
    "Energy: 1000 kWh",
    "Rated power: 500 kW",
    "Quantity: 1",
    "",
    "# Revision history",
    "Rev A  2026-06-02  Initial release (860 kWh)",
    "Rev B  2026-11-03  Usable energy updated to 1000 kWh",
  ],
]);

await makePdf(demo, "SYNTHETIC_Redwood_UL9540A_Summary.pdf", "Redwood Electronics - UL 9540A Test Summary", [
  [
    "# UL 9540A Test Method - Summary of Results",
    "Manufacturer: Lumora Energy Storage (fictional)",
    "Document No.: LES-9540A-SUM",
    "Revision: A",
    "Date: 2026-10-21",
    "Project: Redwood Electronics Assembly (synthetic)",
    "",
    "# Results",
    "Cell level: thermal runaway initiated at 212 C (synthetic)",
    "Module level: no propagation beyond initiating module (synthetic)",
    "Unit level: not required per module-level results (synthetic)",
    "Listing standard: UL 9540A",
  ],
]);

// ---- Synthetic AHJ communication (for the Project Memory scenario; plain text, uploadable as .txt) ----
writeFileSync(join(demo, "SYNTHETIC_AHJ_Email_Holliston_Fire.txt"), [
  "SYNTHETIC DEMO COMMUNICATION - NOT A REAL AHJ MESSAGE",
  "From: Fire Prevention Office, Town of Holliston (fictional sender)",
  "To: EQORE project team",
  "Date: 2026-11-05",
  "Subject: Century Tywood J3 Corp - ESS permit pre-submission comments",
  "",
  "1. Please include the UL 9540A fire test summary with the permit package.",
  "2. Provide a site plan showing 10 ft separation from the building egress door.",
  "3. Include a signed emergency response plan before the final inspection.",
  "",
  "This message is synthetic and was written for software demonstration only.",
  "",
].join("\n"));
console.log("wrote sample-docs/demo/SYNTHETIC_AHJ_Email_Holliston_Fire.txt");
