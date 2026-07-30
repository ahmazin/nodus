/**
 * Layers / Outline panel — a tree of the diagram's objects with per-row select, inline rename,
 * hide/show, lock/unlock, and z-reorder, kept in two-way sync with the canvas selection.
 *
 * Everything type-specific is read straight off the records via the pure `buildLayerTree` helper
 * (exported + unit-tested); the component is a thin, token-styled view over that tree plus the
 * editor commands. It subscribes to `store.sceneNonce` (document mutations) and `selectedAtom`
 * (selection) through `useValue`, so it re-renders on any relevant change.
 *
 * NOTE on `z`: `NodeRecord.z` is a fractional-index STRING (compared lexicographically), not a
 * number — so `LayerNode.z` is a string and siblings sort by that string DESCENDING (front-most on
 * top, the layers convention). Edges carry no z; they are appended as flat top-level leaves.
 */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Editor, EdgeRecord, Id, NodeRecord } from '@ahmazin/core';
import { useValue } from './use-value.js';
import { useUiTokens, type UiTokens } from './ui/tokens.js';
import { injectGlobalStyles } from './ui/global-styles.js';

// ---- pure tree model ---------------------------------------------------------------------------

export interface LayerNode {
  id: Id;
  type: string;
  label: string;
  /** Fractional z-index string (mirrors `NodeRecord.z`); empty for edges, which carry no z. */
  z: string;
  hidden: boolean;
  locked: boolean;
  isEdge: boolean;
  /** Nesting depth (0 = top level). */
  depth: number;
  /** Group children (nodes only). */
  children: LayerNode[];
}

/** record.label (trimmed) if present, else a sensible fallback so every row shows something. */
function displayLabel(r: { label?: string; type: string; id: string }): string {
  const l = r.label?.trim();
  if (l) return l;
  return r.type || r.id;
}

/** Front-most on top: higher z first. z is a fractional-index string → lexicographic compare. */
function byNodeZDesc(a: NodeRecord, b: NodeRecord): number {
  if (a.z < b.z) return 1;
  if (a.z > b.z) return -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Edges have no z; order deterministically by id descending (newest-ish on top). */
function byEdgeIdDesc(a: EdgeRecord, b: EdgeRecord): number {
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Build the layer tree from raw records. Top-level = nodes with no (resolvable) `parentId`; group
 * nodes nest their children (`parentId === group.id`) recursively, siblings ordered by z DESC.
 * Edges are appended as flat top-level `isEdge` leaves after the nodes, ordered by id DESC. A
 * `parentId` that doesn't resolve to a present node is treated as top-level (never dropped), and a
 * `seen` guard makes a pathological parent cycle terminate instead of recursing forever.
 */
export function buildLayerTree(nodes: NodeRecord[], edges: EdgeRecord[]): LayerNode[] {
  const present = new Set<Id>(nodes.map((n) => n.id));
  const childrenByParent = new Map<Id, NodeRecord[]>();
  const roots: NodeRecord[] = [];
  for (const n of nodes) {
    const parent = n.parentId;
    if (parent != null && present.has(parent)) {
      const arr = childrenByParent.get(parent);
      if (arr) arr.push(n);
      else childrenByParent.set(parent, [n]);
    } else {
      roots.push(n);
    }
  }

  const build = (n: NodeRecord, depth: number, path: Set<Id>): LayerNode => {
    const kids =
      path.has(n.id)
        ? []
        : (childrenByParent.get(n.id) ?? [])
            .slice()
            .sort(byNodeZDesc)
            .map((c) => build(c, depth + 1, new Set(path).add(n.id)));
    return {
      id: n.id,
      type: n.type,
      label: displayLabel(n),
      z: n.z,
      hidden: n.hidden === true,
      locked: n.locked === true,
      isEdge: false,
      depth,
      children: kids,
    };
  };

  const nodeRows = roots.slice().sort(byNodeZDesc).map((n) => build(n, 0, new Set<Id>()));
  const edgeRows = edges.slice().sort(byEdgeIdDesc).map(
    (e): LayerNode => ({
      id: e.id,
      type: e.type,
      label: displayLabel(e),
      z: '',
      hidden: false,
      locked: false,
      isEdge: true,
      depth: 0,
      children: [],
    }),
  );
  return [...nodeRows, ...edgeRows];
}

// ---- component ---------------------------------------------------------------------------------

export interface LayersPanelProps {
  editor: Editor;
  className?: string;
  style?: CSSProperties;
}

const svg = (paths: ReactNode, size = 14): ReactElement => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
);

const ICONS = {
  eye: svg(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: svg(<><path d="M3 3l18 18" /><path d="M10.6 6.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.2 6.3A17 17 0 0 0 2 12s3.5 7 10 7a9.4 9.4 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  lock: svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>),
  unlock: svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>),
  up: svg(<path d="M12 19V6M6 11l6-6 6 6" />),
  down: svg(<path d="M12 5v13M6 13l6 6 6-6" />),
  chevron: svg(<path d="M9 6l6 6-6 6" />, 12),
};

/** Small type glyph so a row is legible before its label — a line for edges, a frame for groups,
 *  a filled square for everything else. */
function typeGlyph(ln: LayerNode): ReactElement {
  if (ln.isEdge) return svg(<><path d="M4 20L20 4" /><circle cx="5" cy="19" r="1.6" /><circle cx="19" cy="5" r="1.6" /></>, 13);
  if (ln.type === 'group') return svg(<><rect x="4" y="6" width="16" height="13" rx="2" /><path d="M4 9h6l1.5-2H4z" /></>, 13);
  return svg(<rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none" />, 13);
}

export function LayersPanel({ editor, className, style }: LayersPanelProps): ReactElement {
  useEffect(() => { injectGlobalStyles(); }, []);
  const t = useUiTokens(editor);

  // Subscribe to document + selection changes via STABLE values, then derive the tree with useMemo.
  // Returning a fresh buildLayerTree(...) array straight from useValue makes useSyncExternalStore's
  // getSnapshot change identity on every render → "Maximum update depth exceeded". Key the memo on
  // the scene nonce (a number, referentially stable when unchanged). `selected` is safe as-is:
  // selectedAtom.get() returns the stored Set reference, which only changes when selection changes.
  const version = useValue(() => editor.store.sceneNonce.get());
  const selected = useValue(() => editor.selectedAtom.get());
  const tree = useMemo(
    () => buildLayerTree(editor.store.nodes(), editor.store.edges()),
    [editor, version],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<Id>>(() => new Set());
  const [editing, setEditing] = useState<{ id: Id; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const toggleCollapse = (id: Id): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const beginRename = (ln: LayerNode): void => setEditing({ id: ln.id, value: ln.label });
  const commitRename = (): void => {
    if (editing) editor.updateNode(editing.id, { label: editing.value }, { capture: 'immediately' });
    setEditing(null);
  };

  // ---- token-derived styles (rebuilt per render so the panel re-skins with the theme) ----
  const rowBtn = (active?: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, flex: '0 0 auto', padding: 0, borderRadius: t.radius.sm,
    border: 0, background: 'transparent', cursor: 'pointer',
    color: active ? t.color.accent : t.color.textFaint,
  });

  const renderRow = (ln: LayerNode): ReactNode => {
    const isGroup = ln.type === 'group' && ln.children.length > 0;
    const isCollapsed = collapsed.has(ln.id);
    const isSel = selected.has(ln.id);
    const isEditing = editing?.id === ln.id;
    const rowStyle: CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 4, height: 30, boxSizing: 'border-box',
      paddingLeft: 8 + ln.depth * 15, paddingRight: 6, cursor: 'default',
      borderRadius: t.radius.sm,
      background: isSel ? t.color.selection : 'transparent',
      boxShadow: isSel ? `inset 2px 0 0 ${t.color.accent}` : 'none',
      opacity: ln.hidden ? 0.45 : 1,
    };
    return (
      <Fragment key={ln.id}>
        <div
          data-testid="layer-row"
          data-id={ln.id}
          role="treeitem"
          aria-selected={isSel}
          onMouseDown={(e) => {
            if (isEditing) return;
            editor.select([ln.id], e.shiftKey);
          }}
          style={rowStyle}
        >
          {/* disclosure — groups with children only; a fixed-width slot keeps labels aligned */}
          <span style={{ width: 14, flex: '0 0 auto', display: 'inline-flex', justifyContent: 'center' }}>
            {isGroup && (
              <button
                data-nodus-ui=""
                type="button"
                aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
                aria-expanded={!isCollapsed}
                onMouseDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); toggleCollapse(ln.id); }}
                style={{ ...rowBtn(), width: 14, height: 14, color: t.color.textMuted, transform: isCollapsed ? 'none' : 'rotate(90deg)', transition: 'transform .12s' }}
              >
                {ICONS.chevron}
              </button>
            )}
          </span>

          {/* type glyph */}
          <span style={{ flex: '0 0 auto', display: 'inline-flex', color: ln.isEdge ? t.color.textMuted : t.color.textFaint }}>
            {typeGlyph(ln)}
          </span>

          {/* label / inline rename */}
          {isEditing ? (
            <input
              ref={inputRef}
              data-nodus-ui=""
              value={editing.value}
              autoFocus
              onChange={(e) => setEditing({ id: ln.id, value: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
              }}
              onBlur={commitRename}
              style={{
                flex: 1, minWidth: 0, height: 22, padding: '0 6px',
                background: t.color.canvas, color: t.color.text,
                border: `1px solid ${t.color.accent}`, borderRadius: t.radius.sm,
                fontSize: t.font.size.sm, fontFamily: t.font.family, outline: 'none',
              }}
              aria-label="Rename layer"
            />
          ) : (
            <span
              onDoubleClick={(e) => { e.stopPropagation(); beginRename(ln); }}
              title={ln.label}
              style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: t.font.size.sm, color: isSel ? t.color.text : t.color.textMuted,
                fontStyle: ln.label ? 'normal' : 'italic',
              }}
            >
              {ln.label}
            </span>
          )}

          {/* per-row actions — nodes only for visibility/lock/reorder (edges have no z/hidden/lock) */}
          {!ln.isEdge && (
            <>
              <button
                data-testid="layer-visibility"
                data-nodus-ui=""
                type="button"
                aria-label={ln.hidden ? 'Show' : 'Hide'}
                aria-pressed={ln.hidden}
                title={ln.hidden ? 'Show' : 'Hide'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); editor.setNodesHidden([ln.id], !ln.hidden); }}
                style={rowBtn(ln.hidden)}
              >
                {ln.hidden ? ICONS.eyeOff : ICONS.eye}
              </button>
              <button
                data-testid="layer-lock"
                data-nodus-ui=""
                type="button"
                aria-label={ln.locked ? 'Unlock' : 'Lock'}
                aria-pressed={ln.locked}
                title={ln.locked ? 'Unlock' : 'Lock'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); ln.locked ? editor.unlock([ln.id]) : editor.lock([ln.id]); }}
                style={rowBtn(ln.locked)}
              >
                {ln.locked ? ICONS.lock : ICONS.unlock}
              </button>
              <button
                data-testid="layer-up"
                data-nodus-ui=""
                type="button"
                aria-label="Bring forward"
                title="Bring forward"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); editor.bringForward([ln.id]); }}
                style={rowBtn()}
              >
                {ICONS.up}
              </button>
              <button
                data-testid="layer-down"
                data-nodus-ui=""
                type="button"
                aria-label="Send backward"
                title="Send backward"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); editor.sendBackward([ln.id]); }}
                style={rowBtn()}
              >
                {ICONS.down}
              </button>
            </>
          )}
        </div>
        {isGroup && !isCollapsed && ln.children.map(renderRow)}
      </Fragment>
    );
  };

  const rootStyle: CSSProperties & Record<string, string | number> = {
    // set the focus-ring CSS var locally so the injected :focus-visible ring works even if this
    // panel is mounted outside a UiTokensProvider.
    '--nodus-focus-ring': t.focusRing,
    display: 'flex', flexDirection: 'column', minHeight: 0,
    width: 240, boxSizing: 'border-box',
    background: t.color.panel, color: t.color.text,
    border: `1px solid ${t.color.border}`, borderRadius: t.radius.lg,
    fontFamily: t.font.family, fontSize: t.font.size.sm,
    ...(style as Record<string, string | number>),
  };

  return (
    <div data-testid="layers-panel" data-nodus-ui="" role="tree" aria-label="Layers" className={className} style={rootStyle}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px',
          borderBottom: `1px solid ${t.color.border}`, flex: '0 0 auto',
        }}
      >
        <span style={{ fontSize: t.font.size.md, fontWeight: 600, color: t.color.text }}>Layers</span>
        <span style={{ marginLeft: 'auto', fontFamily: t.font.mono, fontSize: '10.5px', color: t.color.textFaint }}>
          {tree.length}
        </span>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 6 }}>
        {tree.length === 0 ? (
          <div style={{ padding: '18px 12px', textAlign: 'center', color: t.color.textFaint, fontSize: t.font.size.sm }}>
            No objects yet
          </div>
        ) : (
          tree.map(renderRow)
        )}
      </div>
    </div>
  );
}
