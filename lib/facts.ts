// Canonical fact keys shared by every extraction engine, the diff, and the core adapter.
// Safe to import from client components (no server dependencies).
export const FACT_KEYS: Record<string, string> = {
  "equipment.manufacturer": "Manufacturer",
  "equipment.model": "Model",
  "equipment.quantity": "Quantity",
  "rating.current_a": "Rated current (A)",
  "rating.voltage_v": "Rated voltage (V)",
  "rating.interrupting_ka": "Interrupting rating (kA)",
  "rating.power_kw": "Power (kW)",
  "rating.energy_kwh": "Energy (kWh)",
  "rating.frequency_hz": "Frequency (Hz)",
  chemistry: "Battery chemistry",
  "enclosure.rating": "Enclosure rating",
  "revision.label": "Revision",
  "doc.date": "Document date",
  "doc.number": "Document number",
  "meter.serial": "Revenue meter serial",
  "pole.number": "Utility pole number",
  "permit.number": "Permit number",
  "listing.standard": "Listing standard (UL)",
  "site.address": "Site address",
  "utility.account": "Utility account",
};

/** Canonical unit per numeric key, and accepted equivalent units → multiplier into the canonical unit. */
export const UNIT_RULES: Record<string, { canonical: string; units: Record<string, number> }> = {
  "rating.voltage_v": { canonical: "V", units: { v: 1, vac: 1, vdc: 1, kv: 1000, kvac: 1000, mv: 1e6 } },
  "rating.current_a": { canonical: "A", units: { a: 1, amp: 1, amps: 1, ka: 1000, ma: 0.001 } },
  "rating.interrupting_ka": { canonical: "kA", units: { ka: 1, a: 0.001, kaic: 1, "ka sym": 1 } },
  "rating.power_kw": { canonical: "kW", units: { kw: 1, w: 0.001, mw: 1000, kwac: 1 } },
  "rating.energy_kwh": { canonical: "kWh", units: { kwh: 1, wh: 0.001, mwh: 1000 } },
  "rating.frequency_hz": { canonical: "Hz", units: { hz: 1 } },
  "equipment.quantity": { canonical: "", units: { "": 1, ea: 1, units: 1, pcs: 1 } },
};

/** Metadata keys: a change is informational, not an engineering change by itself. */
export const INFORMATIONAL_KEYS = new Set(["revision.label", "doc.date", "doc.number"]);
