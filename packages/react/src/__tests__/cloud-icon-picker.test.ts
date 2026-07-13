import { describe, expect, it } from 'vitest';
import { filterCatalog, type IconCatalogEntry } from '../cloud-icon-catalog.js';

const CAT: IconCatalogEntry[] = [
  { name: 'aws:lambda', provider: 'aws', service: 'lambda', category: 'compute' },
  { name: 'aws:rds', provider: 'aws', service: 'rds', category: 'database' },
  { name: 'azure:functions', provider: 'azure', service: 'functions', category: 'compute' },
  { name: 'gcp:bigquery', provider: 'gcp', service: 'bigquery', category: 'analytics' },
];

describe('filterCatalog', () => {
  it('returns everything for an empty query and all providers', () => {
    expect(filterCatalog(CAT, '', 'all')).toHaveLength(4);
    expect(filterCatalog(CAT, '   ', 'all')).toHaveLength(4);
  });

  it('matches the query as a substring over name/service/category/provider', () => {
    expect(filterCatalog(CAT, 'lambda', 'all').map((e) => e.name)).toEqual(['aws:lambda']);
    expect(filterCatalog(CAT, 'database', 'all').map((e) => e.name)).toEqual(['aws:rds']);
    expect(filterCatalog(CAT, 'GCP', 'all').map((e) => e.name)).toEqual(['gcp:bigquery']);
    expect(filterCatalog(CAT, 'compute', 'all').map((e) => e.name)).toEqual(['aws:lambda', 'azure:functions']);
  });

  it('restricts to a provider and combines it with the query', () => {
    expect(filterCatalog(CAT, '', 'aws')).toHaveLength(2);
    expect(filterCatalog(CAT, 'compute', 'azure').map((e) => e.name)).toEqual(['azure:functions']);
    expect(filterCatalog(CAT, 'lambda', 'azure')).toHaveLength(0);
  });
});
