/**
 * Token-consuming UI primitives for the Nodus DOM chrome. Panels (WS-D) and the shell (WS-E) build
 * on these instead of re-deriving colors/spacing. Styling is inline-from-tokens (repo convention).
 *
 * Tokens are supplied via **context** — wrap the chrome in `<UiTokensProvider tokens={...}>` (the
 * host does this once with `useUiTokens(editor)`), and every primitive reads them with
 * `useUiTokensContext`. Every primitive also accepts an optional `tokens` prop that overrides the
 * context for one-off use outside a provider. Each primitive root carries `data-nodus-ui` (so the
 * global stylesheet's resets + `:focus-visible` ring apply) and sets the `--nodus-focus-ring` /
 * `--nodus-font` CSS vars so the ring is token-accurate regardless of nesting.
 */

import {
  createContext,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { UiTokens } from './tokens.js';

// ---------------------------------------------------------------------------
// Tokens context
// ---------------------------------------------------------------------------

const UiTokensContext = createContext<UiTokens | null>(null);

export function UiTokensProvider(
  { tokens, children }: { tokens: UiTokens; children: ReactNode },
): ReactElement {
  return <UiTokensContext.Provider value={tokens}>{children}</UiTokensContext.Provider>;
}

/** Read the ambient UI tokens. Throws if used outside a `<UiTokensProvider>`. */
export function useUiTokensContext(): UiTokens {
  const t = useContext(UiTokensContext);
  if (!t) throw new Error('useUiTokensContext must be used within a <UiTokensProvider>');
  return t;
}

/** Resolve tokens: explicit prop wins, else context. */
function useTokens(explicit?: UiTokens): UiTokens {
  const ctx = useContext(UiTokensContext);
  const t = explicit ?? ctx;
  if (!t) throw new Error('Nodus UI primitive needs a `tokens` prop or a <UiTokensProvider>');
  return t;
}

/** Merge the chrome CSS vars (focus ring, font) onto a style object. */
function withVars(t: UiTokens, style?: CSSProperties): CSSProperties {
  return {
    ['--nodus-focus-ring']: t.focusRing,
    ['--nodus-font']: t.font.family,
    ...style,
  } as CSSProperties;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tokens?: UiTokens;
  /** Popover elevation (stronger shadow, `panel` surface) vs. a flat inline surface. */
  elevated?: boolean;
}

export function Panel(
  { tokens, elevated = false, style, children, ...rest }: PanelProps,
): ReactElement {
  const t = useTokens(tokens);
  return (
    <div
      data-nodus-ui=""
      {...rest}
      style={withVars(t, {
        background: elevated ? t.color.panel : t.color.surface,
        color: t.color.text,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.lg,
        boxShadow: elevated ? t.shadow.popover : t.shadow.panel,
        fontFamily: t.font.family,
        fontSize: t.font.size.sm,
        ...style,
      })}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button / IconButton
// ---------------------------------------------------------------------------

export type ButtonVariant = 'default' | 'primary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

function variantStyle(t: UiTokens, variant: ButtonVariant, active: boolean): CSSProperties {
  switch (variant) {
    case 'primary':
      return { background: t.color.accent, color: t.color.accentText, borderColor: t.color.accent };
    case 'ghost':
      return {
        background: active ? t.color.surfaceHover : 'transparent',
        color: t.color.text,
        borderColor: 'transparent',
      };
    default:
      return {
        background: active ? t.color.surfaceHover : t.color.surface,
        color: t.color.text,
        borderColor: t.color.border,
      };
  }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tokens?: UiTokens;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Toggle/active visual state (e.g. a selected tool). */
  active?: boolean;
}

export function Button(
  { tokens, variant = 'default', size = 'md', active = false, disabled, style, children, ...rest }: ButtonProps,
): ReactElement {
  const t = useTokens(tokens);
  const padY = size === 'sm' ? t.space(1) : t.space(1.5);
  const padX = size === 'sm' ? t.space(2) : t.space(3);
  return (
    <button
      data-nodus-ui=""
      type="button"
      disabled={disabled}
      {...rest}
      style={withVars(t, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: t.space(1),
        padding: `${padY}px ${padX}px`,
        borderRadius: t.radius.md,
        border: '1px solid transparent',
        fontFamily: t.font.family,
        fontSize: t.font.size.sm,
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        transition: 'background 120ms ease, border-color 120ms ease',
        ...variantStyle(t, variant, active),
        ...style,
      })}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  tokens?: UiTokens;
  /** Required — icon-only controls must be labelled for assistive tech. */
  'aria-label': string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export function IconButton(
  { tokens, icon, variant = 'ghost', size = 'md', active = false, disabled, style, ...rest }: IconButtonProps,
): ReactElement {
  const t = useTokens(tokens);
  const dim = size === 'sm' ? 24 : 30;
  return (
    <button
      data-nodus-ui=""
      type="button"
      disabled={disabled}
      aria-pressed={active || undefined}
      {...rest}
      style={withVars(t, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        padding: 0,
        borderRadius: t.radius.md,
        border: '1px solid transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        ...variantStyle(t, variant, active),
        ...style,
      })}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field / Row
// ---------------------------------------------------------------------------

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  tokens?: UiTokens;
  label: ReactNode;
  /** Lay the label beside the control instead of above it. */
  inline?: boolean;
}

export function Field(
  { tokens, label, inline = false, style, children, ...rest }: FieldProps,
): ReactElement {
  const t = useTokens(tokens);
  return (
    <label
      data-nodus-ui=""
      {...rest}
      style={withVars(t, {
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: inline ? 'center' : 'stretch',
        gap: inline ? t.space(2) : t.space(1),
        fontFamily: t.font.family,
        ...style,
      })}
    >
      <span style={{ fontSize: t.font.size.xs, color: t.color.textMuted, userSelect: 'none' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  tokens?: UiTokens;
  /** Gap in spacing-scale steps (default 2 -> 8px). */
  gap?: number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
}

export function Row(
  { tokens, gap = 2, align = 'center', justify, style, children, ...rest }: RowProps,
): ReactElement {
  const t = useTokens(tokens);
  return (
    <div
      data-nodus-ui=""
      {...rest}
      style={withVars(t, {
        display: 'flex',
        flexDirection: 'row',
        alignItems: align,
        justifyContent: justify,
        gap: t.space(gap),
        ...style,
      })}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu / MenuItem
// ---------------------------------------------------------------------------

export interface MenuProps extends HTMLAttributes<HTMLDivElement> {
  tokens?: UiTokens;
}

export function Menu({ tokens, style, children, ...rest }: MenuProps): ReactElement {
  const t = useTokens(tokens);
  return (
    <div
      data-nodus-ui=""
      role="menu"
      {...rest}
      style={withVars(t, {
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 180,
        padding: t.space(1),
        background: t.color.panel,
        color: t.color.text,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.md,
        boxShadow: t.shadow.popover,
        fontFamily: t.font.family,
        fontSize: t.font.size.sm,
        ...style,
      })}
    >
      {children}
    </div>
  );
}

export interface MenuItemProps extends HTMLAttributes<HTMLDivElement> {
  tokens?: UiTokens;
  disabled?: boolean;
  danger?: boolean;
  /** aria-selected / active row (e.g. `aria-activedescendant` target). */
  selected?: boolean;
  /** Optional leading icon / trailing shortcut hint. */
  icon?: ReactNode;
  shortcut?: ReactNode;
}

export function MenuItem(
  {
    tokens, disabled = false, danger = false, selected = false, icon, shortcut,
    style, children, onMouseEnter, onMouseLeave, ...rest
  }: MenuItemProps,
): ReactElement {
  const t = useTokens(tokens);
  const [hover, setHover] = useState(false);
  const active = (hover || selected) && !disabled;
  return (
    <div
      data-nodus-ui=""
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-selected={selected || undefined}
      onMouseEnter={(e) => { setHover(true); onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); onMouseLeave?.(e); }}
      {...rest}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: t.space(2),
        padding: `${t.space(1.5)}px ${t.space(2)}px`,
        borderRadius: t.radius.sm,
        fontSize: t.font.size.sm,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? t.color.textFaint : danger ? t.color.danger : t.color.text,
        background: active ? t.color.surfaceHover : 'transparent',
        opacity: disabled ? 0.7 : 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {icon != null && <span style={{ display: 'inline-flex', flex: '0 0 auto' }}>{icon}</span>}
      <span style={{ flex: '1 1 auto' }}>{children}</span>
      {shortcut != null && (
        <span style={{ flex: '0 0 auto', color: t.color.textFaint, fontSize: t.font.size.xs }}>
          {shortcut}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  tokens?: UiTokens;
  vertical?: boolean;
}

export function Divider(
  { tokens, vertical = false, style, ...rest }: DividerProps,
): ReactElement {
  const t = useTokens(tokens);
  return (
    <div
      data-nodus-ui=""
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      {...rest}
      style={
        vertical
          ? { width: 1, alignSelf: 'stretch', background: t.color.border, ...style }
          : { height: 1, width: '100%', background: t.color.border, ...style }
      }
    />
  );
}
