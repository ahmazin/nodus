/**
 * Types + pure search logic for the cloud icon picker, kept JSX-free so it unit-tests under the
 * node vitest environment (mirrors flow-shared.ts). The .tsx component imports these; tests import
 * filterCatalog directly. @nodus/react declares its OWN IconCatalogEntry so it never depends on
 * @nodus/icons-cloud — the cloudIconCatalog value is structurally assignable to it.
 */
export interface IconCatalogEntry {
  name: string;
  provider: 'aws' | 'azure' | 'gcp';
  service: string;
  category: string;
}

export type ProviderFilter = 'all' | 'aws' | 'azure' | 'gcp';

/** Filter by a free-text query (substring over name/service/category/provider) and provider. */
export function filterCatalog(
  catalog: IconCatalogEntry[],
  query: string,
  provider: ProviderFilter,
): IconCatalogEntry[] {
  const q = query.trim().toLowerCase();
  return catalog.filter((e) => {
    if (provider !== 'all' && e.provider !== provider) return false;
    if (!q) return true;
    return `${e.name} ${e.service} ${e.category} ${e.provider}`.toLowerCase().includes(q);
  });
}

export type ProviderCounts = Record<ProviderFilter, number>;

/**
 * Per-provider match counts for a query. Query-aware: `all` is the total that match the query, and
 * each provider is its share — so the picker's chips can show live counts that narrow as you type.
 */
export function catalogCounts(catalog: IconCatalogEntry[], query: string): ProviderCounts {
  const matched = filterCatalog(catalog, query, 'all');
  const counts: ProviderCounts = { all: matched.length, aws: 0, azure: 0, gcp: 0 };
  for (const e of matched) counts[e.provider]++;
  return counts;
}
