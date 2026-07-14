import { installPack } from './install.js';
import { azurePack } from './generated/azure-pack.js';

export { azurePack };

export function installAzureIcons(): void {
  installPack(azurePack);
}
