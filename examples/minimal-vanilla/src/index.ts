// Minimal headless Nodus: build a small diagram with the one mutation channel, then serialize it to
// the canonical, git-diffable JSON string and print it. No browser, no DOM.
import { Editor, toCanonicalString } from '@nodus/core';
import { installInfraPreset } from '@nodus/preset-infra';

const editor = new Editor({ viewport: { w: 1200, h: 700 } });
installInfraPreset(editor);

const api = editor.createNode({ type: 'infra.service', label: 'API', x: 0, y: 0 });
const db = editor.createNode({ type: 'infra.db', label: 'Postgres', x: 300, y: 0 });
editor.connect({ kind: 'node', nodeId: api, portId: 'out' }, { kind: 'node', nodeId: db, portId: 'in' });

// editor.toJSON() is a diff-friendly Snapshot; toCanonicalString pins the exact bytes (stable key
// order, normalized numbers) — the form the `nodus` CLI checks into git.
const canonical = toCanonicalString(editor.toJSON());
console.log(canonical);
