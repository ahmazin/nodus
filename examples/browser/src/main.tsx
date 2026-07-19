/**
 * Nodus reference editor — the product surface built on `@nodus/react`'s shell + design system.
 *
 * Composition: a `<Nodus>` canvas host with the built-in `Toolbar`, left `ToolPalette`,
 * `ZoomControls`, `ThemeToggle`, `UndoRedo`, and shortcut help, plus the `Properties` / `Minimap` /
 * `CommandPalette` / `CloudIconPicker` panels — all skinned from one theme atom and wired to
 * localStorage autosave + open/save. `window.__editor` stays exposed for the E2E drive.
 */

import { StrictMode, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, renderSVG, type NodusRecord } from '@nodus/core';
import {
  ArrowIcon,
  Button,
  CircleIcon,
  CloudIconPicker,
  CommandPalette,
  ConnectIcon,
  DiamondIcon,
  Divider,
  EraserIcon,
  HandIcon,
  HelpIcon,
  IconButton,
  ImageIcon,
  LineIcon,
  Minimap,
  Nodus,
  OpenIcon,
  Properties,
  SaveIcon,
  SelectIcon,
  ShortcutsDialog,
  SquareIcon,
  TextIcon,
  ThemeToggle,
  Toolbar,
  ToolPalette,
  UiTokensProvider,
  UndoRedo,
  ZoomControls,
  copyOrDownloadImage,
  defaultCommands,
  exportFlowGIF,
  injectGlobalStyles,
  openFromFile,
  restoreAutosave,
  saveToFile,
  showToast,
  useAutosave,
  useUiTokens,
  useValue,
  type Command,
  type ShortcutSection,
  type ToolPaletteEntry,
} from '@nodus/react';
import {
  INFRA_TYPES,
  darkInfraTheme,
  infraLightTheme,
  installInfraPreset,
  modelToRecords,
  type InfraKind,
} from '@nodus/preset-infra';
import { iconNode, imageNode } from '@nodus/preset-diagrams';
import { cloudIconCatalog, installCloudIcons } from '@nodus/icons-cloud';
import { drawShortcut, installDrawTools } from '@nodus/preset-draw';
import { dagreLayout } from '@nodus/layout-dagre';
import { treeLayout } from '@nodus/layout-tree';
import { forceLayout } from '@nodus/layout-force';
import { elkLayout } from '@nodus/layout-elk';
import { freehandPlugin } from '@nodus/plugin-freehand';
import { importMermaid } from '@nodus/from-mermaid';
import { fromKubernetes, fromTerraform } from '@nodus/import-infra';

const AUTOSAVE_KEY = 'nodus-example';

function buildEditor(): Editor {
  const editor = new Editor({ viewport: { w: 1200, h: 700 } });
  installInfraPreset(editor); // registers infra types + the dark theme (appearance: 'dark')
  installDrawTools(editor);
  installCloudIcons();
  editor.registerNodeType(iconNode);
  editor.registerNodeType(imageNode); // 'diagram.image' — raster insert / paste target
  editor.use(freehandPlugin); // registers the 'freehand' node type + pen tool (plugin API only)
  editor.registerLayout(dagreLayout);
  editor.registerLayout(treeLayout);
  editor.registerLayout(forceLayout);
  editor.registerLayout(elkLayout); // also the default engine for Mermaid import

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

/** Read a File as a `data:` URI (self-contained, canonical-serializable image source). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Decode an image to get its intrinsic pixel size. */
function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('decode failed'));
    img.src = dataUrl;
  });
}

/** Pencil glyph for the freehand tool — matches the shell's stroke-based, 24×24 `currentColor` icon set. */
function PenIcon({ size = 16 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d="M4 20l1-4 10-10a2 2 0 0 1 3 3L8 19z" />
      <path d="M13.5 6.5l3.5 3.5" />
    </svg>
  );
}

/** Documented shortcuts, matching what this app actually binds. */
const SHORTCUTS: ShortcutSection[] = [
  {
    title: 'Tools',
    items: [
      { keys: 'V', description: 'Select / move' },
      { keys: 'R', description: 'Rectangle' },
      { keys: 'E', description: 'Ellipse' },
      { keys: 'D', description: 'Diamond' },
      { keys: 'T', description: 'Text' },
      { keys: 'L', description: 'Line' },
      { keys: 'A', description: 'Arrow' },
      { keys: 'P', description: 'Draw (freehand)' },
    ],
  },
  {
    title: 'Edit',
    items: [
      { keys: '⌘Z', description: 'Undo' },
      { keys: '⇧⌘Z', description: 'Redo' },
      { keys: ['⌫'], description: 'Delete selection' },
    ],
  },
  {
    title: 'View & files',
    items: [
      { keys: '⌘K', description: 'Command palette' },
      { keys: '?', description: 'This help' },
      { keys: '⌘O', description: 'Open .nodus.json' },
      { keys: '⌘S', description: 'Save .nodus.json' },
    ],
  },
];

function App(): ReactElement {
  const editor = useMemo(buildEditor, []);
  const t = useUiTokens(editor);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createType, setCreateType] = useState<InfraKind>('service');
  const [sketchOn, setSketchOn] = useState(false);

  const canvasStyle: CSSProperties = { position: 'absolute', inset: 0 };

  // Restore a previous session if one exists (mount-only; the seed model stands if there's none).
  useEffect(() => {
    try {
      restoreAutosave(editor, AUTOSAVE_KEY, { fit: true });
    } catch {
      showToast('Could not restore the last session', 'error', { mode: editor.themeAtom.peek().appearance ?? 'dark' });
    }
  }, [editor]);

  useAutosave(editor, { key: AUTOSAVE_KEY });

  // Keyboard: tool shortcuts (draw preset) + undo/redo/delete + `?` help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editor.editingAtom.peek()) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          e.shiftKey ? editor.redo() : editor.undo();
        } else if (k === 's') {
          e.preventDefault();
          saveToFile(editor);
        } else if (k === 'o') {
          e.preventDefault();
          void openFromFile(editor).catch(() => showToast('Not a valid Nodus file', 'error', { mode: t.mode }));
        }
        return;
      }

      if (e.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const ids = editor.selectedIdsArray();
        if (ids.length) {
          e.preventDefault();
          editor.deleteRecords(ids);
        }
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        editor.setTool('freehand');
        return;
      }
      drawShortcut(editor, e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, t.mode]);

  const selCount = useValue(() => editor.selectedAtom.get().size);
  const nodeCount = useValue(() => (editor.sceneIndex.version.get(), editor.store.nodes().length));

  const insertImage = useCallback((): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        try {
          const src = await fileToDataUrl(file);
          const { width, height } = await imageSize(src);
          const max = 320;
          const scale = Math.min(1, max / Math.max(width, height));
          const w = Math.round(width * scale) || 160;
          const h = Math.round(height * scale) || 120;
          const vp = editor.worldViewport();
          editor.createNode({
            type: 'diagram.image',
            x: vp.x + vp.w / 2 - w / 2,
            y: vp.y + vp.h / 2 - h / 2,
            w,
            h,
            props: { src, naturalWidth: width, naturalHeight: height, alt: file.name, fit: 'contain' },
          });
        } catch {
          showToast('Could not insert that image', 'error', { mode: t.mode });
        }
      })();
    };
    input.click();
  }, [editor, t.mode]);

  const openFile = useCallback((): void => {
    void openFromFile(editor).catch(() => showToast('Not a valid Nodus file', 'error', { mode: t.mode }));
  }, [editor, t.mode]);

  // Importers — add the parsed records in one undoable step, reindex, then lay out + fit. These are
  // the same programmatic importers the CLI/MCP use; a prompt() paste is enough for the reference app.
  const runImport = useCallback(
    (records: NodusRecord[], layoutId: string): void => {
      if (records.length === 0) {
        showToast('Nothing to import from that input', 'error', { mode: t.mode });
        return;
      }
      editor.store.apply(
        records.map((record) => ({ op: 'add' as const, record })),
        { capture: 'immediately' }, // one undo entry for the whole import
      );
      editor.sceneIndex.rebuild(editor.store.allRecords());
      void editor.layout(layoutId, { direction: 'LR' }).then(() => editor.zoomToFit(48));
    },
    [editor, t.mode],
  );

  const importMermaidFlow = useCallback((): void => {
    const src = window.prompt('Paste a Mermaid diagram (flowchart / stateDiagram / erDiagram)');
    if (!src?.trim()) return;
    // importMermaid registers the diagram node types, adds the records, runs the layout, and fits.
    void importMermaid(editor, src, { layout: 'elk' }).catch(() =>
      showToast('Could not parse that Mermaid diagram', 'error', { mode: t.mode }),
    );
  }, [editor, t.mode]);

  const importTerraformFlow = useCallback((): void => {
    const text = window.prompt('Paste `terraform show -json` output');
    if (!text?.trim()) return;
    try {
      runImport(fromTerraform(JSON.parse(text)), 'dagre');
    } catch {
      showToast('Not valid `terraform show -json` output', 'error', { mode: t.mode });
    }
  }, [t.mode, runImport]);

  const importKubernetesFlow = useCallback((): void => {
    const text = window.prompt('Paste Kubernetes manifests as JSON (an array, or `kubectl get -o json`)');
    if (!text?.trim()) return;
    try {
      const parsed = JSON.parse(text);
      const objects = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [parsed];
      runImport(fromKubernetes(objects), 'dagre');
    } catch {
      showToast('Not valid Kubernetes JSON', 'error', { mode: t.mode });
    }
  }, [t.mode, runImport]);

  // ⌘K command set: the shell defaults (which include a "Layout: <id>" per registered engine — now
  // dagre/tree/force/elk) plus the importers, grouped under "Import".
  const commands = useMemo<Command[]>(
    () => [
      ...defaultCommands(editor),
      { id: 'import.mermaid', title: 'Import Mermaid…', group: 'Import', run: importMermaidFlow },
      { id: 'import.terraform', title: 'Import Terraform (show -json)…', group: 'Import', run: importTerraformFlow },
      { id: 'import.kubernetes', title: 'Import Kubernetes (JSON)…', group: 'Import', run: importKubernetesFlow },
    ],
    [editor, importMermaidFlow, importTerraformFlow, importKubernetesFlow],
  );

  // The left tool palette — config-driven, so it stays preset-agnostic. Eraser only if registered.
  const tools = useMemo<ToolPaletteEntry[]>(() => {
    const list: ToolPaletteEntry[] = [
      { id: 'select', label: 'Select', toolId: 'select', icon: <SelectIcon />, shortcut: 'V', testId: 'tool-select' },
      { id: 'hand', label: 'Pan', toolId: 'hand', icon: <HandIcon /> },
      'divider',
      { id: 'rect', label: 'Rectangle', toolId: 'create', config: { type: 'draw.rect' }, icon: <SquareIcon />, shortcut: 'R' },
      { id: 'ellipse', label: 'Ellipse', toolId: 'create', config: { type: 'draw.ellipse' }, icon: <CircleIcon />, shortcut: 'E' },
      { id: 'diamond', label: 'Diamond', toolId: 'create', config: { type: 'draw.diamond' }, icon: <DiamondIcon />, shortcut: 'D' },
      { id: 'text', label: 'Text', toolId: 'create', config: { type: 'draw.text' }, icon: <TextIcon />, shortcut: 'T' },
      { id: 'freehand', label: 'Draw', toolId: 'freehand', icon: <PenIcon />, shortcut: 'P' },
      'divider',
      { id: 'line', label: 'Line', toolId: 'line', config: { type: 'draw.line' }, icon: <LineIcon />, shortcut: 'L' },
      { id: 'arrow', label: 'Arrow', toolId: 'line', config: { type: 'draw.arrow' }, icon: <ArrowIcon />, shortcut: 'A' },
      'divider',
      { id: 'connect', label: 'Connect nodes', toolId: 'connect', icon: <ConnectIcon /> },
    ];
    if (editor.toolManager.has('eraser')) {
      list.push({ id: 'eraser', label: 'Eraser', toolId: 'eraser', icon: <EraserIcon /> });
    }
    return list;
  }, [editor]);

  return (
    <UiTokensProvider tokens={t}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.color.canvas }}>
        <Toolbar editor={editor} aria-label="Editor toolbar">
          <strong style={{ color: t.color.accent, fontSize: t.font.size.md, letterSpacing: '0.01em' }}>Nodus</strong>
          <Divider vertical style={{ height: 20 }} />
          <UndoRedo editor={editor} />
          <Divider vertical style={{ height: 20 }} />
          {/* Infra node creator — pick a type, then place it on the canvas with the create tool. */}
          <select
            data-testid="type-select"
            aria-label="Infra node type"
            value={createType}
            onChange={(e) => {
              const next = e.target.value as InfraKind;
              setCreateType(next);
              if (editor.currentToolId === 'create') editor.setTool('create', { type: `infra.${next}` });
            }}
            style={{
              height: 30,
              padding: `0 ${t.space(1.5)}px`,
              borderRadius: t.radius.md,
              border: `1px solid ${t.color.border}`,
              background: t.color.surface,
              color: t.color.text,
              fontFamily: t.font.family,
              fontSize: t.font.size.sm,
            }}
          >
            {INFRA_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button data-testid="tool-create" onClick={() => editor.setTool('create', { type: `infra.${createType}` })}>
            Create
          </Button>
          <Button variant="ghost" onClick={insertImage}>
            <ImageIcon /> Image
          </Button>
          <CloudIconPicker editor={editor} catalog={cloudIconCatalog} />
          <Button data-testid="layout" variant="ghost" onClick={() => void editor.layout('dagre', { direction: 'LR' })}>
            Auto-layout
          </Button>
          <Button
            variant="ghost"
            onClick={() => void copyOrDownloadImage(editor, { selection: editor.selectedIdsArray().length > 0 })}
          >
            Copy PNG
          </Button>
          <Button
            variant="ghost"
            title="Export the diagram as a vector SVG file"
            onClick={() => {
              // animateFlow keeps any live flow moving in the exported .svg (a no-op when no edge
              // has flow, so the static output is unchanged).
              const blob = new Blob([renderSVG(editor, { animateFlow: true })], { type: 'image/svg+xml' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'diagram.svg';
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export SVG
          </Button>
          <Button
            variant="ghost"
            title="Export the diagram as an animated GIF — a raster fallback for the animated SVG (plays in GitHub READMEs, etc.)"
            onClick={async () => {
              try {
                const blob = await exportFlowGIF(editor);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'diagram.gif';
                a.click();
                URL.revokeObjectURL(a.href);
              } catch {
                showToast('Nothing to export — the diagram is empty', 'error', { mode: t.mode });
              }
            }}
          >
            Export GIF
          </Button>
          {/* Global hand-drawn toggle: applies the seeded 'sketchy' roughness to every node's style
              bag (per-element roughness survives theme swaps). Fine-grained control stays in Properties. */}
          <Button
            variant="ghost"
            aria-pressed={sketchOn}
            title="Toggle a hand-drawn (sketchy) look for the whole diagram"
            onClick={() => {
              const next = !sketchOn;
              setSketchOn(next);
              editor.setStyle(
                editor.store.nodes().map((n) => n.id),
                { roughness: next ? 1.6 : 0 },
              );
            }}
          >
            {sketchOn ? '✎ Sketch: on' : '✎ Sketch'}
          </Button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: t.space(2) }}>
            <span data-testid="status" style={{ fontSize: t.font.size.xs, color: t.color.textMuted }}>
              {nodeCount} nodes · {selCount} selected
            </span>
            <Divider vertical style={{ height: 20 }} />
            <IconButton icon={<OpenIcon />} aria-label="Open file" title="Open .nodus.json (⌘O)" onClick={openFile} />
            <IconButton icon={<SaveIcon />} aria-label="Save file" title="Save .nodus.json (⌘S)" onClick={() => saveToFile(editor)} />
            <Divider vertical style={{ height: 20 }} />
            <ZoomControls editor={editor} />
            <ThemeToggle editor={editor} light={infraLightTheme} dark={darkInfraTheme} />
            <IconButton icon={<HelpIcon />} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)} />
          </div>
        </Toolbar>

        <div style={{ position: 'relative', flex: 1 }}>
          {/* `imageNodeType` routes system-clipboard image pastes to the registered image node. */}
          <Nodus editor={editor} style={canvasStyle} imageNodeType="diagram.image" />

          <ToolPalette
            editor={editor}
            tools={tools}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
          />

          <Properties editor={editor} style={{ position: 'absolute', right: 12, top: 12 }} />

          <div
            data-testid="minimap"
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              border: `1px solid ${t.color.border}`,
              borderRadius: t.radius.lg,
              overflow: 'hidden',
              background: t.color.panel,
              boxShadow: t.shadow.panel,
            }}
          >
            <Minimap editor={editor} width={200} height={130} />
          </div>

          <CommandPalette editor={editor} commands={commands} />
          <ShortcutsDialog editor={editor} open={helpOpen} onClose={() => setHelpOpen(false)} sections={SHORTCUTS} />
        </div>
      </div>
    </UiTokensProvider>
  );
}

injectGlobalStyles();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
