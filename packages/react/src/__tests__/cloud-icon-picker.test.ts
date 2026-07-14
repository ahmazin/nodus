import { describe, expect, it } from 'vitest';
import { catalogCounts, filterCatalog, type IconCatalogEntry } from '../cloud-icon-catalog.js';

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

describe('catalogCounts', () => {
  it('counts all + per provider for an empty query', () => {
    expect(catalogCounts(CAT, '')).toEqual({ all: 4, aws: 2, azure: 1, gcp: 1 });
  });

  it('narrows the counts as the query narrows (query-aware)', () => {
    expect(catalogCounts(CAT, 'compute')).toEqual({ all: 2, aws: 1, azure: 1, gcp: 0 });
    expect(catalogCounts(CAT, 'bigquery')).toEqual({ all: 1, aws: 0, azure: 0, gcp: 1 });
  });

  it('is zero everywhere for a no-match query', () => {
    expect(catalogCounts(CAT, 'zzz')).toEqual({ all: 0, aws: 0, azure: 0, gcp: 0 });
  });

  it('keeps `all` equal to the total across providers', () => {
    const c = catalogCounts(CAT, 'a');
    expect(c.all).toBe(c.aws + c.azure + c.gcp);
  });
});
