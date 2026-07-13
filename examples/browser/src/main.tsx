import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@nodus/core';
import { CommandPalette, CloudIconPicker, Minimap, Nodus, Properties, copyImage, useValue } from '@nodus/react';
import { INFRA_TYPES, installInfraPreset, modelToRecords, type InfraKind } from '@nodus/preset-infra';
import { iconNode } from '@nodus/preset-diagrams';
import { cloudIconCatalog, installCloudIcons } from '@nodus/icons-cloud';
import { drawShortcut, installDrawTools } from '@nodus/preset-draw';
import { dagreLayout } from '@nodus/layout-dagre';

function buildEditor(): Editor {
  const editor = new Editor({ viewport: { w: 1200, h: 700 } });
  installInfraPreset(editor);
  installDrawTools(editor);
  installCloudIcons();
  editor.registerNodeType(iconNode);
  editor.registerLayout(dagreLayout);
  const records = modelToRecords({
    nodes: [
      { key: 'cdn', type: 'edge', label: 'CDN / Edge', x: 40, y: 300 },
      { key: 'lb', type: 'lb', label: 'Load Balancer', x: 250, y: 300 },
      { key: 'gw', type: 'service', label: 'API Gateway', x: 470, y: 180 },
      { key: 'auth', type: 'service', label: 'Auth Service', x: 470, y: 320, focused: true },
      { key: 'orders', type: 'service', label: 'Orders API', x: 470, y: 460 },
      { key: 'redis', type: 'cache', label: 'Redis', x: 720, y: 180, overlay: 'met' },
      { key: 'pg', type: 'db', label: 'Postgres', x: 720, y: 330, overlay: 'partial' },
      { key: 'kafka', type: 'queue', label: 'Kafka', x: 720, y: 480, overlay: 'missed' },
      { key: 'pay', type: 'service', label: 'Payments', x: 980, y: 260, state: 'solid' },
      { key: 'legacy', type: 'service', label: 'Legacy', x: 980, y: 420, state: 'locked' },
    ],
    edges: [
      { from: 'cdn', to: 'lb' },
      { from: 'lb', to: 'gw' },
      { from: 'lb', to: 'auth' },
      { from: 'lb', to: 'orders' },
      { from: 'gw', to: 'redis' },
      { from: 'auth', to: 'pg' },
      { from: 'orders', to: 'pg' },
      { from: 'orders', to: 'kafka' },
      { from: 'orders', to: 'pay' },
      { from: 'pay', to: 'legacy' },
    ],
  });
  editor.loadSnapshot({ schemaVersion: 1, document: { records } }, { fit: true });
  // expose for e2e verification
  (window as unknown as { __editor: Editor }).__editor = editor;
  return editor;
}

const BTN: CSSProperties = {
  background: '#12161c',
  color: '#e5e5e5',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#2a322f',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

function App(): ReactElement {
  const editor = useMemo(buildEditor, []);
  const [tool, setToolState] = useState('select');
  const [createType, setCreateType] = useState<InfraKind>('service');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || editor.editingAtom.peek()) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (drawShortcut(editor, e.key)) setToolState(editor.currentToolId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  const canUndo = useValue(() => (editor.history.version.get(), editor.history.canUndo()));
  const canRedo = useValue(() => (editor.history.version.get(), editor.history.canRedo()));
  const selCount = useValue(() => editor.selectedAtom.get().size);
  const nodeCount = useValue(() => (editor.sceneIndex.version.get(), editor.store.nodes().length));

  const setTool = (id: string, cfg?: Record<string, unknown>): void => {
    editor.setTool(id, cfg);
    setToolState(id);
  };
  const activeStyle = (id: string): CSSProperties =>
    tool === id ? { ...BTN, borderColor: '#10b981', color: '#10b981' } : BTN;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        data-testid="toolbar"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: 10,
          borderBottom: '1px solid #1c2320',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ color: '#10b981', marginRight: 6 }}>Nodus</strong>
        <button data-testid="tool-select" style={activeStyle('select')} onClick={() => setTool('select')}>
          Select
        </button>
        <button data-testid="tool-connect" style={activeStyle('connect')} onClick={() => setTool('connect')}>
          Connect
        </button>
        <button data-testid="tool-create" style={activeStyle('create')} onClick={() => setTool('create', { type: `infra.${createType}` })}>
          Create
        </button>
        <select
          data-testid="type-select"
          value={createType}
          onChange={(e) => {
            const t = e.target.value as InfraKind;
            setCreateType(t);
            if (tool === 'create') setTool('create', { type: `infra.${t}` });
          }}
          style={{ ...BTN, padding: '6px' }}
        >
          {INFRA_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span style={{ width: 1, height: 22, background: '#1c2320' }} />
        <CloudIconPicker editor={editor} catalog={cloudIconCatalog} />
        <span style={{ width: 1, height: 22, background: '#1c2320' }} />
        <button data-testid="undo" style={BTN} disabled={!canUndo} onClick={() => editor.undo()}>
          Undo
        </button>
        <button data-testid="redo" style={BTN} disabled={!canRedo} onClick={() => editor.redo()}>
          Redo
        </button>
        <button data-testid="delete" style={BTN} onClick={() => editor.deleteRecords(editor.selectedIdsArray())}>
          Delete
        </button>
        <button data-testid="fit" style={BTN} onClick={() => editor.zoomToFit(64)}>
          Fit
        </button>
        <button data-testid="copy" style={BTN} onClick={() => void copyImage(editor, { selection: editor.selectedIdsArray().length > 0 })}>
          Copy PNG
        </button>
        <button data-testid="layout" style={BTN} onClick={() => void editor.layout('dagre', { direction: 'LR' })}>
          Auto-layout
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#3a423f' }} data-testid="status">
          {nodeCount} nodes · {selCount} selected · ⌘K commands · right-click menu · dbl-click rename
        </span>
      </div>
      <div style={{ position: 'relative', flex: 1 }}>
        <Nodus editor={editor} style={{ position: 'absolute', inset: 0 }} />
        <div
          data-testid="minimap"
          style={{ position: 'absolute', right: 12, bottom: 12, border: '1px solid #1c2320', borderRadius: 8, overflow: 'hidden', background: '#0b110e', boxShadow: '0 6px 20px -8px rgba(0,0,0,0.7)' }}
        >
          <Minimap editor={editor} width={200} height={130} />
        </div>
        <Properties editor={editor} style={{ position: 'absolute', right: 12, top: 12 }} />
        <CommandPalette editor={editor} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
