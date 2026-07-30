import { drawVectorIcon, registerIcon, type VectorIcon } from '@ahmazin/core';

export function installPack(pack: Record<string, VectorIcon>): void {
  for (const [name, icon] of Object.entries(pack)) {
    registerIcon(
      name,
      (ctx, x, y, s) => drawVectorIcon(ctx, icon, { x, y, w: s, h: s }),
      icon.needsChip ? { needsChip: true } : undefined,
    );
  }
}
