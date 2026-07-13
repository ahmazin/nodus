import { installPack } from './install.js';
import { gcpPack } from './generated/gcp-pack.js';

export { gcpPack };

export function installGcpIcons(): void {
  installPack(gcpPack);
}
