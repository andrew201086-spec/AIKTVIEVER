import * as cornerstone from '@cornerstonejs/core';

/**
 * Metadata we parsed ourselves from local files, keyed by imageId.
 *
 * Cornerstone's wadouri provider can only answer once a file has been decoded,
 * but the volume loader asks for geometry before decoding starts. Registering
 * this ahead of it closes that gap.
 */
const metadataMap = new Map<string, Record<string, any>>();

let registered = false;

export function registerCustomMetadataProvider(priority: number): void {
  if (registered) return;
  cornerstone.metaData.addProvider(customMetadataProvider, priority);
  registered = true;
}

export function addCustomMetadata(imageId: string, metadata: Record<string, any>): void {
  metadataMap.set(imageId, metadata);
}

export function removeCustomMetadata(imageIds: string[]): void {
  imageIds.forEach((id) => metadataMap.delete(id));
}

export function clearCustomMetadata(): void {
  metadataMap.clear();
}

function customMetadataProvider(type: string, imageId: string): any {
  const meta = metadataMap.get(imageId);
  if (!meta) return undefined;
  // Returning undefined lets Cornerstone fall through to the next provider,
  // so we only shadow the modules we actually parsed.
  return meta[type];
}
