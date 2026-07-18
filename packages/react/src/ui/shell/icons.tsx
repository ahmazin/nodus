/**
 * A small, dependency-free SVG icon set for the Nodus shell. Icons are stroke-based and inherit
 * `currentColor`, so they take the surrounding button's token color automatically and re-skin with
 * the theme. All are `aria-hidden` — labelling lives on the interactive control that wraps them.
 *
 * These are exported so an app can build its own tool palette / toolbar with glyphs that match the
 * built-in shell (see the reference example).
 */

import type { ReactElement, ReactNode } from 'react';

export interface IconProps {
  /** Square dimension in px (default 16). */
  size?: number;
  strokeWidth?: number;
}

function Svg({ size = 16, strokeWidth = 1.8, children }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {children}
    </svg>
  );
}

// --- tools -----------------------------------------------------------------

export function SelectIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M5 4l14 6-6.2 1.7L11 19z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function HandIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-1.3a5 5 0 0 1-3.6-1.5L4.6 13.3a1.6 1.6 0 0 1 2.3-2.2L9 13" />
    </Svg>
  );
}

export function ConnectIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8 8l8 8" />
    </Svg>
  );
}

export function ShapeIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Svg>
  );
}

export function SquareIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </Svg>
  );
}

export function CircleIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="7.5" />
    </Svg>
  );
}

export function DiamondIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 4l8 8-8 8-8-8z" />
    </Svg>
  );
}

export function LineIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M5 19L19 5" />
    </Svg>
  );
}

export function ArrowIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M5 19L19 5" />
      <path d="M12 5h7v7" />
    </Svg>
  );
}

export function TextIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M6 5h12M12 5v14M9.5 19h5" />
    </Svg>
  );
}

export function EraserIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M4.5 14.5l6-6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 18H8.5z" />
      <path d="M9 20h10" />
    </Svg>
  );
}

export function ImageIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M5 17l4.5-4.5 3.5 3.5L16 13l3 3" />
    </Svg>
  );
}

// --- zoom ------------------------------------------------------------------

export function MinusIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Frame corners — "fit to content". */
export function FitIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
    </Svg>
  );
}

// --- history ---------------------------------------------------------------

export function UndoIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </Svg>
  );
}

export function RedoIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12h-9a6 6 0 0 0-6 6v1" />
    </Svg>
  );
}

// --- theme -----------------------------------------------------------------

export function SunIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M20 14A8 8 0 0 1 10 4a7 7 0 1 0 10 10z" />
    </Svg>
  );
}

// --- misc ------------------------------------------------------------------

export function HelpIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.6 2.5c-.9.5-1.2 1-1.2 1.8" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

/** Tray with a down-arrow — "save / download". */
export function SaveIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M12 4v10" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </Svg>
  );
}

export function OpenIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M4 8V6a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v1" />
      <path d="M3.4 10.5h17.2l-1.9 7.6a1 1 0 0 1-1 .9H6.3a1 1 0 0 1-1-.9z" />
    </Svg>
  );
}

export function CloseIcon(p: IconProps): ReactElement {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}
