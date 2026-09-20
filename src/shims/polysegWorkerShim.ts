/**
 * Stand-in for @cornerstonejs/tools' polySeg worker registration.
 *
 * PolySeg converts segmentations between labelmap, contour and surface
 * representations — this viewer has no segmentation, so the only thing the
 * real module contributes is a Vite-built web worker. That worker shares
 * chunks with the app bundle and drags the tools store into a different chunk
 * from its own ToolGroupManager, producing an import cycle that breaks the
 * production build with "Cannot access '…' before initialization".
 *
 * Paired with the @icr/polyseg-wasm shim, which stubs the WASM side.
 */
export function registerPolySegWorker(): void {
  // Intentionally empty — nothing in this application asks for polyseg.
}
