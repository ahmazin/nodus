import { describe, expect, it } from 'vitest';
import { detectImportFormat, analyzeImport } from './import-analyze';

describe('detectImportFormat', () => {
  it('detects mermaid by header', () => {
    expect(detectImportFormat('flowchart LR\n A --> B')).toBe('mermaid');
    expect(detectImportFormat('  stateDiagram-v2\n [*] --> On')).toBe('mermaid');
    expect(detectImportFormat('erDiagram\n A ||--o{ B : has')).toBe('mermaid');
  });
  it('detects terraform by JSON shape', () => {
    expect(detectImportFormat('{"values":{"root_module":{"resources":[]}}}')).toBe('terraform');
    expect(detectImportFormat('{"planned_values":{"root_module":{}},"configuration":{}}')).toBe('terraform');
  });
  it('detects kubernetes from JSON and from YAML', () => {
    expect(detectImportFormat('{"kind":"Deployment","apiVersion":"apps/v1"}')).toBe('kubernetes');
    expect(detectImportFormat('[{"kind":"Service","apiVersion":"v1"}]')).toBe('kubernetes');
    expect(detectImportFormat('apiVersion: v1\nkind: Service\nmetadata:\n  name: x')).toBe('kubernetes');
  });
  it('returns null for unknown content', () => {
    expect(detectImportFormat('just some prose')).toBeNull();
    expect(detectImportFormat('')).toBeNull();
  });
});

describe('analyzeImport', () => {
  it('summarizes a terraform paste (nodes, edges, notes)', () => {
    const a = analyzeImport('{"values":{"root_module":{"resources":[{"address":"aws_instance.web","type":"aws_instance","name":"web"}]}}}', 'terraform');
    expect(a.error).toBeNull();
    expect(a.nodeCount).toBe(1);
    expect(a.notes.join(' ')).toMatch(/state JSON/i); // no configuration block
  });
  it('summarizes a kubernetes YAML paste with skipped kinds', () => {
    const a = analyzeImport('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c', 'kubernetes');
    expect(a.nodeCount).toBe(0);
    expect(a.skipped).toEqual([{ label: 'ConfigMap', count: 1 }]);
  });
  it('returns a real error (not a throw) for malformed input', () => {
    const a = analyzeImport('{ not json', 'terraform');
    expect(a.error).toMatch(/JSON/i);
    expect(a.records).toHaveLength(0);
  });
  it('summarizes mermaid and counts nodes', () => {
    const a = analyzeImport('flowchart LR\n A[Web] --> B[(DB)]', 'mermaid');
    expect(a.error).toBeNull();
    expect(a.nodeCount).toBe(2);
  });
  it('carries the parsed mermaid direction; other formats leave it undefined', () => {
    const mermaid = analyzeImport('flowchart TB\n  A --> B', 'mermaid');
    expect(mermaid.direction).toBe('TB');
    const terraform = analyzeImport('{"values":{"root_module":{"resources":[]}}}', 'terraform');
    expect(terraform.direction).toBeUndefined();
  });
});
