import { installPack } from './install.js';
import { awsPack } from './generated/aws-pack.js';

export { awsPack };

export function installAwsIcons(): void {
  installPack(awsPack);
}
