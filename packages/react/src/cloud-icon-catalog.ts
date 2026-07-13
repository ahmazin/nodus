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
