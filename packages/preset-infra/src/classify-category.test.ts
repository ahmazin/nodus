import { describe, it, expect } from 'vitest';
import { classifyCategory } from './classify-category.js';

describe('classifyCategory', () => {
  it('maps store/queue/gateway/client/compute labels onto the matching InfraKind', () => {
    expect(classifyCategory('Kafka')).toBe('queue');
    expect(classifyCategory('Redis')).toBe('cache');
    expect(classifyCategory('Postgres')).toBe('db');
    expect(classifyCategory('S3 bucket')).toBe('db');
    expect(classifyCategory('API Gateway')).toBe('lb');
    expect(classifyCategory('Load Balancer')).toBe('lb');
    expect(classifyCategory('CDN / Edge')).toBe('edge');
    expect(classifyCategory('Auth Service')).toBe('service');
  });

  it('is case-insensitive and priority-ordered (cache beats the generic db bucket)', () => {
    expect(classifyCategory('redis CACHE')).toBe('cache'); // cache rule precedes db
    expect(classifyCategory('primary DATABASE')).toBe('db');
  });

  it('returns undefined for an unrecognized or empty label (falls back to neutral)', () => {
    expect(classifyCategory('Legacy')).toBeUndefined();
    expect(classifyCategory('Payments')).toBeUndefined();
    expect(classifyCategory('')).toBeUndefined();
    expect(classifyCategory(undefined)).toBeUndefined();
  });
});
