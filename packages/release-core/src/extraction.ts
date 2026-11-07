import type { AIExtractionAdapter, DocumentVersion, ExtractedFact, FactField, FactInput, VersionComparison } from './models.js';
import { canonicalJson, immutable, IntelligenceError } from './utils.js';

export const factFields: readonly FactField[] = Object.freeze(['batteryCapacityKWh', 'powerRatingKW', 'manufacturer', 'equipmentModel', 'inverterQuantity', 'voltageV', 'currentA', 'frequencyHz', 'revisionLabel']);
const units: Record<FactField, string | null> = { batteryCapacityKWh: 'kWh', powerRatingKW: 'kW', manufacturer: null, equipmentModel: null, inverterQuantity: null, voltageV: 'V', currentA: 'A', frequencyHz: 'Hz', revisionLabel: null };
const labels: [FactField, RegExp][] = [
  ['batteryCapacityKWh', /^(?:battery capacity|capacity)\s*:\s*(\d+(?:\.\d+)?)\s*kWh\s*$/i],
  ['powerRatingKW', /^(?:power rating|rated power|power)\s*:\s*(\d+(?:\.\d+)?)\s*kW\s*$/i],
  ['manufacturer', /^manufacturer\s*:\s*(\S.*)$/i],
  ['equipmentModel', /^(?:equipment model|model)\s*:\s*(\S.*)$/i],
  ['inverterQuantity', /^(?:inverter quantity|inverter count)\s*:\s*(\d+)\s*$/i],
  ['voltageV', /^(?:voltage|rated voltage|voltage rating)\s*:\s*(\d+(?:\.\d+)?)\s*V\s*$/i],
  ['currentA', /^(?:current|rated current|current rating)\s*:\s*(\d+(?:\.\d+)?)\s*A\s*$/i],
  ['frequencyHz', /^(?:frequency|rated frequency)\s*:\s*(\d+(?:\.\d+)?)\s*Hz\s*$/i],
  ['revisionLabel', /^(?:revision|revision label|rev)\s*:\s*(\S.*)$/i],
];
const numericFields = new Set<FactField>(['batteryCapacityKWh', 'powerRatingKW', 'inverterQuantity', 'voltageV', 'currentA', 'frequencyHz']);
export function extractFacts(text: string, versionId: string): readonly ExtractedFact[] {
  let offset = 0; const facts: ExtractedFact[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    for (const [field, regex] of labels) {
      const match = regex.exec(line); if (!match) continue;
      const value = numericFields.has(field) ? Number(match[1]) : match[1]!.trim();
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      const start = offset + raw.indexOf(line);
      facts.push({ field, value, unit: units[field], evidence: { documentVersionId: versionId, excerpt: line, start, end: start + line.length, line: index + 1 }, confidence: 1, verification: 'source-supported', origin: 'deterministic' });
    }
    offset += raw.length + 1;
  });
  return immutable(facts);
}
/** Evidence offsets are validated. Structured/AI facts need an independent exact parser match to be source-supported. */
export function validateFacts(text: string, versionId: string, inputs: readonly FactInput[], origin: 'structured' | 'ai' = 'structured'): readonly ExtractedFact[] {
  const deterministic = extractFacts(text, versionId);
  return immutable(inputs.map(input => {
    if (!factFields.includes(input.field)) throw new IntelligenceError('INVALID_FACT', 'Unsupported fact field');
    const { start, end, excerpt, line, page } = input.evidence;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length || text.slice(start, end) !== excerpt || !Number.isInteger(line) || line !== text.slice(0, start).split('\n').length || (page !== undefined && (!Number.isInteger(page) || page < 1))) throw new IntelligenceError('INVALID_EVIDENCE', 'Evidence must point to an exact nonempty excerpt and line in the supplied text');
    if (numericFields.has(input.field) ? typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || (input.field === 'inverterQuantity' && !Number.isInteger(input.value)) : typeof input.value !== 'string' || !input.value.trim()) throw new IntelligenceError('INVALID_FACT', 'Fact value has invalid type or range');
    const confidence = input.confidence ?? 1;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new IntelligenceError('INVALID_FACT', 'Confidence must be in [0,1]');
    const unit = input.unit ?? units[input.field];
    if (unit !== units[input.field]) throw new IntelligenceError('INVALID_FACT', `Expected unit ${units[input.field]}`);
    const supported = deterministic.some(f => f.field === input.field && f.value === input.value && f.evidence.start >= start && f.evidence.end <= end);
    return { field: input.field, value: input.value, unit, evidence: { ...input.evidence, documentVersionId: versionId }, confidence, verification: supported && input.verification !== 'needs-verification' ? 'source-supported' as const : 'needs-verification' as const, origin };
  }));
}
export async function extractWithAdapter(adapter: AIExtractionAdapter, input: { versionId: string; text: string }): Promise<readonly ExtractedFact[]> {
  // Explicit opt-in boundary: caller decides whether the input may leave its environment.
  const facts = await adapter.extract({ ...input });
  if (facts.some(f => f.evidence.page !== undefined)) throw new IntelligenceError('INVALID_EVIDENCE', 'A text-only AI adapter cannot substantiate page numbers');
  return validateFacts(input.text, input.versionId, facts, 'ai');
}
export function compareVersions(before: DocumentVersion, after: DocumentVersion): VersionComparison {
  if (before.documentId !== after.documentId || before.siteId !== after.siteId) throw new IntelligenceError('IDENTITY_MISMATCH', 'Compare revisions of the same site document');
  const changes = factFields.flatMap(field => {
    const old = before.facts.filter(f => f.field === field), next = after.facts.filter(f => f.field === field);
    const values = (facts: readonly ExtractedFact[]) => [...new Set(facts.map(f => f.value))].sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
    const oldValue = values(old), newValue = values(next);
    if (canonicalJson(oldValue) === canonicalJson(newValue)) return [];
    const facts = [...old, ...next];
    return [{ field, oldValue, newValue, oldEvidence: old.map(f => f.evidence), newEvidence: next.map(f => f.evidence), verification: facts.every(f => f.verification === 'source-supported') ? 'source-supported' as const : 'needs-verification' as const, confidence: Math.min(...facts.map(f => f.confidence)), engineeringReviewRequired: field !== 'revisionLabel' }];
  });
  return immutable({ documentId: before.documentId, fromVersionId: before.id, toVersionId: after.id, contentChanged: before.contentHash !== after.contentHash, revisionLabelChanged: before.revisionLabel !== after.revisionLabel, changes });
}
