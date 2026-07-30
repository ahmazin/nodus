import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor, Rectangle2d, type NodeUtil } from '@ahmazin/core';
import { Nodus, useNodusEditor } from '@ahmazin/react';

// A custom node type. `getGeometry` is the one declarative source the engine uses for bounds,
// culling, hit-testing, and snapping; `draw` paints against the resolved theme tokens (never
// hard-coded colours — that is what lets a theme swap re-skin every node in one frame).
const stickyNote: NodeUtil = {
  type: 'sticky',
  getDefaultProps: () => ({}),
  getDefaultSize: () => ({ w: 160, h: 100 }),
  getGeometry: (n) => new Rectangle2d({ x: n.x, y: n.y, w: n.w, h: n.h }),
  draw: (api, n, t) => {
    const box = { x: n.x, y: n.y, w: n.w, h: n.h };
    api.fillRoundRect(box, t.radius, t.fill, { glow: t.glow ?? undefined });
    api.strokeRoundRect(box, t.radius, t.stroke, { width: t.strokeWidth });
    if (n.label) api.label(n.label, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
  },
};

function App() {
  // useNodusEditor builds the editor once and disposes it on unmount (StrictMode-safe).
  const editor = useNodusEditor(() => {
    const e = new Editor();
    e.registerNodeType(stickyNote);
    e.createNode({ type: 'sticky', x: 60, y: 60, label: 'Hello Nodus' });
    return e;
  });
  return <Nodus editor={editor} style={{ position: 'absolute', inset: 0 }} />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
