import { createHash } from 'node:crypto';
import { canonicalJson } from './legacy.js';
export { canonicalJson, checksum } from './legacy.js';
export class IntelligenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: unknown = null) { super(message); this.name = 'IntelligenceError'; }
}
export function requireText(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new IntelligenceError('INVALID_INPUT', `${label} must be nonempty`);
}
export function immutable<T>(value: T): T {
  const clone = JSON.parse(canonicalJson(value)) as T;
  function freeze(v: unknown): void { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(clone); return clone;
}
export function bytesHash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function sortedUnique(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
