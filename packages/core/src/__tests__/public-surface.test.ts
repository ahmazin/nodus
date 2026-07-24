/**
 * Public-surface snapshots (task B5/D4). Each package's RUNTIME exports (Object.keys) are pinned to a
 * checked-in, hand-reviewed list. POLICY: adding or removing a public export MUST update the matching
 * list HERE, in the same PR — a diff to this file is the reviewer's signal that the public API changed.
 *
 * Dynamic imports isolate each package so one package's load failure can't hide another's snapshot.
 */
import { describe, expect, it } from 'vitest';

// @nodus/core — generated from the post-B5 surface (makeId/seedIdCounter are @internal and absent).
const CORE_SURFACE: string[] = [
  'CommandRegistry',
  'ConnectTool',
  'CreateNodeTool',
  'DEFAULT_CAMERA',
  'DEFAULT_CAPABILITIES',
  'DEFAULT_EDGE_CAPABILITIES',
  'DrawApi',
  'Editor',
  'Ellipse2d',
  'EventBus',
  'Geometry2d',
  'HandTool',
  'History',
  'IDENTITY',
  'IconRegistry',
  'MAX_NEST_DEPTH',
  'NodusError',
  'OP',
  'Polygon2d',
  'Polyline2d',
  'Rectangle2d',
  'Registry',
  'RouterRegistry',
  'SCHEMA_VERSION',
  'STENCIL',
  'SVGContext',
  'SceneIndex',
  'SelectTool',
  'Store',
  'ToolManager',
  'ToolNode',
  'add',
  'applyMat',
  'atom',
  'batch',
  'bezierRouter',
  'blueprintTheme',
  'boxCenter',
  'boxContains',
  'boxEncloses',
  'boxIntersects',
  'clamp',
  'colorForValue',
  'compareRecords',
  'computed',
  'defaultLightTheme',
  'defaultRouters',
  'defaultTheme',
  'defaultTools',
  'deterministicIdFactory',
  'diff',
  'dist',
  'distToSegment',
  'drawEdgeLabel',
  'drawGrid',
  'drawIcon',
  'drawStencil',
  'drawVectorIcon',
  'easeInOutCubic',
  'easeOutCubic',
  'effect',
  'fillBackground',
  'fillHandle',
  'fitBox',
  'getIcon',
  'getIconMeta',
  'groupNodeUtil',
  'iconNames',
  'inTransaction',
  'installDefaultCommands',
  'installDefaultIcons',
  'invertMat',
  'isEdge',
  'isNode',
  'isNodusError',
  'isPage',
  'len',
  'lightTheme',
  'lineEdgeUtil',
  'linear',
  'matMul',
  'measureStencil',
  'neonTheme',
  'orthogonalRouter',
  'padBox',
  'paintItem',
  'panByScreen',
  'paperTheme',
  'pisTheme',
  'reaction',
  'rectNodeUtil',
  'registerIcon',
  'renderMatrix',
  'renderSVG',
  'resolveFlow',
  'resolveTokens',
  'restore',
  'scale',
  'screenToWorld',
  'segmentHitsBoxInterior',
  'serializeRecords',
  'sessionIdFactory',
  'setEffectErrorHandler',
  'setPaintErrorHandler',
  'stableStringify',
  'straightRouter',
  'strokeWorldBox',
  'sub',
  'themePack',
  'toCanonicalString',
  'transact',
  'unionBox',
  'unknownNodeUtil',
  'untrack',
  'validateEdgeUtil',
  'validateNodeUtil',
  'vec',
  'viewportWorldBounds',
  'worldToScreen',
  'zoomAt',
];

// @nodus/preset-diagrams — value exports only (DecodedImage is a type, so it is not a runtime key).
const PRESET_DIAGRAMS_SURFACE: string[] = [
  'IMAGE_CACHE_CAP',
  'ROW_H',
  'buildERD',
  'buildFlowchart',
  'buildOrgChart',
  'buildStateMachine',
  'cardNode',
  'clearImageCache',
  'decisionNode',
  'diagramEdgeUtils',
  'diagramNodeUtils',
  'diagramsLightTheme',
  'diagramsTheme',
  'flowEdge',
  'getImage',
  'iconNode',
  'imageCacheSize',
  'imageNode',
  'installDiagrams',
  'pillNode',
  'processNode',
  'setImageDecoder',
  'setImageInvalidator',
  'stateNode',
  'tableNode',
];

describe('public surface — @nodus/core', () => {
  it('exports exactly the checked-in set (no accidental additions/removals)', async () => {
    const ns = await import('@nodus/core');
    expect(Object.keys(ns).sort()).toEqual([...CORE_SURFACE].sort());
  });
});

// The preset-diagrams + react snapshots are gated on a cross-lane migration: preset-diagrams/index.ts,
// preset-infra/facade.ts and react/stencil-library.tsx still `import { makeId } from '@nodus/core'`,
// which B5 removed — those must move to `sessionIdFactory()` (flagged to the lead). react additionally
// needs its source-path gifenc import resolved. Un-skip once the tree links; the preset-diagrams list
// is already generated and ready.
describe.skip('public surface — @nodus/preset-diagrams (pending makeId→sessionIdFactory migration)', () => {
  it('exports exactly the checked-in set', async () => {
    const ns = await import('@nodus/preset-diagrams');
    expect(Object.keys(ns).sort()).toEqual([...PRESET_DIAGRAMS_SURFACE].sort());
  });
});

describe.skip('public surface — @nodus/react (pending makeId migration + gifenc source resolution)', () => {
  it('exports exactly the checked-in set', async () => {
    const ns = await import('@nodus/react');
    // TODO: generate the checked-in list once @nodus/react imports cleanly in the test env.
    expect(Object.keys(ns).sort().length).toBeGreaterThan(0);
  });
});
