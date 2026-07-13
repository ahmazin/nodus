import { installAwsIcons } from './aws.js';
import { installAzureIcons } from './azure.js';
import { installGcpIcons } from './gcp.js';

export { installAwsIcons, awsPack } from './aws.js';
export { installAzureIcons, azurePack } from './azure.js';
export { installGcpIcons, gcpPack } from './gcp.js';
export { installPack } from './install.js';

export function installCloudIcons(): void {
  installAwsIcons();
  installAzureIcons();
  installGcpIcons();
}
