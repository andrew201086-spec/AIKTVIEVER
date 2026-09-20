/**
 * What the browser's WebGL implementation can actually do with a CT volume,
 * and how the voxels are stored once it does.
 *
 * This decides how many bytes a voxel costs — which decides whether a study
 * fits on the GPU at all — so the renderer setup and the size estimates on the
 * series screen have to agree on it.
 */

let norm16Support: boolean | null = null;

/**
 * A 16-bit volume is half the size of a float32 one, which is the difference
 * between a full-resolution CBCT rendering and not rendering at all. The
 * 16-bit path needs EXT_texture_norm16; without it we stay on float32 and
 * large studies get their slices thinned instead.
 */
export function hasNorm16Textures(): boolean {
  if (norm16Support !== null) return norm16Support;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    norm16Support = !!gl && !!gl.getExtension('EXT_texture_norm16');
  } catch {
    norm16Support = false;
  }
  return norm16Support;
}

/** Bytes the volume loader allocates per voxel in the current mode. */
export function volumeBytesPerVoxel(): number {
  return hasNorm16Textures() ? 2 : 4;
}

/**
 * Largest volume the renderer will put on screen.
 *
 * Past this the texture upload fails without raising anything and every
 * viewport shows flat grey — the voxels are in memory and correct, they just
 * never reach the GPU. Measured on an Apple M2: 754 MB renders, 1.5 GB does
 * not. Anything above the budget is offered with slices thinned out instead.
 */
export const RENDER_BUDGET_BYTES = 1024 * 1024 * 1024;

/** WebGL's HALF_FLOAT enum value. */
const GL_HALF_FLOAT = 0x140b;

/**
 * Whether the volume's 16-bit samples are half-floats rather than integers.
 *
 * Cornerstone uploads a 16-bit volume by converting it to half-float *in
 * place* — it rewrites the very buffer the volume exposes as its scalar data.
 * Anything reading a voxel afterwards gets the raw half-float bit pattern:
 * 40 HU reads back as 20736. Rendering is unaffected (the shader knows the
 * format), but a density readout has to undo it, which is why we ask the
 * texture what it actually holds.
 */
export function volumeUsesHalfFloat(viewport: any): boolean {
  try {
    const mapper = viewport?.getActors?.()[0]?.actor?.getMapper?.();
    const texture = mapper?.scalarTexture || mapper?.getScalarTexture?.();
    return texture?.getOpenGLDataType?.() === GL_HALF_FLOAT;
  } catch {
    return false;
  }
}

/** Decodes one IEEE 754 half-float from its 16-bit pattern. */
export function decodeHalfFloat(bits: number): number {
  const h = bits & 0xffff;
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (fraction + 1024) * 2 ** (exponent - 25);
}
