/**
 * Searchable catalog of the curated cloud icons — the data a picker UI browses. Derived from
 * ALLOWLIST (the single source of truth) so it can never drift from what build:icons generates.
 */
import { ALLOWLIST } from './allowlist.js';

export interface IconCatalogEntry {
  name: string; // registry key + node props.icon, e.g. 'aws:lambda'
  provider: 'aws' | 'azure' | 'gcp';
  service: string; // 'lambda'
  category: string; // 'compute' | 'database' | ...
}

export const cloudIconCatalog: IconCatalogEntry[] = ALLOWLIST.map((e) => ({
  name: e.name,
  provider: e.provider,
  service: e.service,
  category: e.category,
}));
