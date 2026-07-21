import { describe, expect, it } from 'vitest';
import { classifyIcon } from './classify-icon.js';

describe('classifyIcon', () => {
  it('maps keywords to registered core glyph names', () => {
    expect(classifyIcon('Auth Lambda')).toBe('function');
    expect(classifyIcon('Orders Queue (Kafka)')).toBe('queue');
    expect(classifyIcon('Postgres')).toBe('database');
    expect(classifyIcon('Redis cache')).toBe('cache');
    expect(classifyIcon('S3 bucket')).toBe('bucket');
    expect(classifyIcon('API Gateway')).toBe('globe');
    expect(classifyIcon('Auth service')).toBe('user'); // 'auth' matches before 'service'
  });
  it('returns undefined for no match or empty', () => {
    expect(classifyIcon('Widget 42')).toBeUndefined();
    expect(classifyIcon(undefined)).toBeUndefined();
    expect(classifyIcon('')).toBeUndefined();
  });
  it('only ever returns registered core glyph names', () => {
    const REGISTERED = new Set(['server','database','cache','queue','balancer','globe','cloud','user','gear','code','box','lock','function','bucket']);
    for (const l of ['lambda','kafka','redis','postgres','s3','gateway','load balancer','auth','vault','ec2','frontend','config','cloud','nothing']) {
      const r = classifyIcon(l);
      if (r !== undefined) expect(REGISTERED.has(r)).toBe(true);
    }
  });
});
