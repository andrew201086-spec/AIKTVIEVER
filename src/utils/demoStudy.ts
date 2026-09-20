/**
 * Synthetic CBCT generator — a real DICOM Part 10 byte stream, not a mock, so
 * it exercises exactly the same parsing and volume path as a scanner export.
 * Useful for checking the viewer without patient data on the machine.
 */

interface DicomWriter {
  bytes: number[];
  str: (tag: number, vr: string, value: string) => void;
  us: (tag: number, value: number) => void;
  ul: (tag: number, value: number) => void;
}

function createWriter(): DicomWriter {
  const bytes: number[] = [];

  const tagBytes = (tag: number) => {
    const group = (tag >> 16) & 0xffff;
    const element = tag & 0xffff;
    bytes.push(group & 0xff, (group >> 8) & 0xff, element & 0xff, (element >> 8) & 0xff);
  };

  return {
    bytes,
    str(tag, vr, value) {
      const encoded = Array.from(new TextEncoder().encode(value));
      // Every DICOM value must occupy an even number of bytes.
      if (encoded.length % 2 !== 0) encoded.push(vr === 'UI' ? 0x00 : 0x20);
      tagBytes(tag);
      bytes.push(vr.charCodeAt(0), vr.charCodeAt(1));
      bytes.push(encoded.length & 0xff, (encoded.length >> 8) & 0xff);
      bytes.push(...encoded);
    },
    us(tag, value) {
      tagBytes(tag);
      bytes.push(0x55, 0x53, 2, 0); // 'US', length 2
      bytes.push(value & 0xff, (value >> 8) & 0xff);
    },
    ul(tag, value) {
      tagBytes(tag);
      bytes.push(0x55, 0x4c, 4, 0); // 'UL', length 4
      bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
    },
  };
}

function buildSlice(
  pixelData: Int16Array,
  dim: number,
  sliceIndex: number,
  totalSlices: number,
  sliceThickness: number,
  pixelSpacing: number
): File {
  const preamble = new Uint8Array(132);
  preamble.set([0x44, 0x49, 0x43, 0x4d], 128); // 'DICM'

  const sopInstanceUID = `1.2.826.0.1.3680043.9.7.1.${sliceIndex}`;

  // File Meta Information (group 0002). Its declared length must match the
  // bytes that follow exactly — parsers use it to find where the main dataset
  // begins, and a wrong value makes them read header text as pixel data.
  const meta = createWriter();
  meta.str(0x00020002, 'UI', '1.2.840.10008.5.1.4.1.1.2'); // CT Image Storage
  meta.str(0x00020003, 'UI', sopInstanceUID);
  meta.str(0x00020010, 'UI', '1.2.840.10008.1.2.1'); // Explicit VR Little Endian
  meta.str(0x00020012, 'UI', '1.2.826.0.1.3680043.9.7.1'); // Implementation Class UID

  const w = createWriter();
  w.ul(0x00020000, meta.bytes.length);
  w.bytes.push(...meta.bytes);

  w.str(0x00080005, 'CS', 'ISO_IR 192'); // UTF-8 — the description below is Cyrillic
  w.str(0x00080016, 'UI', '1.2.840.10008.5.1.4.1.1.2'); // CT Image Storage
  w.str(0x00080018, 'UI', sopInstanceUID);
  w.str(0x00080060, 'CS', 'CT');
  w.str(0x0008103e, 'LO', 'CBCT демо-модель челюсти');
  w.str(0x00081030, 'LO', 'Тестовое исследование');
  w.str(0x00100010, 'PN', 'DEMO^PATIENT');
  w.str(0x0020000d, 'UI', '1.2.826.0.1.3680043.9.7.1.100');
  w.str(0x0020000e, 'UI', '1.2.826.0.1.3680043.9.7.1.200');
  w.str(0x00200011, 'IS', '1');
  w.str(0x00200013, 'IS', String(sliceIndex + 1));

  const half = (dim * pixelSpacing) / 2;
  const z = (sliceIndex - totalSlices / 2) * sliceThickness;
  w.str(0x00200032, 'DS', `${-half}\\${-half}\\${z}`);
  w.str(0x00200037, 'DS', '1\\0\\0\\0\\1\\0');
  w.str(0x00200052, 'UI', '1.2.826.0.1.3680043.9.7.1.300');

  w.str(0x00180050, 'DS', String(sliceThickness));
  w.str(0x00280004, 'CS', 'MONOCHROME2');
  w.us(0x00280002, 1);
  w.us(0x00280010, dim);
  w.us(0x00280011, dim);
  w.str(0x00280030, 'DS', `${pixelSpacing}\\${pixelSpacing}`);
  w.us(0x00280100, 16);
  w.us(0x00280101, 16);
  w.us(0x00280102, 15);
  w.us(0x00280103, 1); // signed — Hounsfield units go negative
  w.str(0x00281050, 'DS', '480');
  w.str(0x00281051, 'DS', '2500');
  w.str(0x00281052, 'DS', '0');
  w.str(0x00281053, 'DS', '1');

  const byteLength = pixelData.byteLength;
  const pixelTag = new Uint8Array([
    0xe0, 0x7f, 0x10, 0x00, // (7FE0,0010)
    0x4f, 0x57, // 'OW'
    0x00, 0x00, // reserved
    byteLength & 0xff,
    (byteLength >> 8) & 0xff,
    (byteLength >> 16) & 0xff,
    (byteLength >> 24) & 0xff,
  ]);

  const blob = new Blob(
    [preamble, new Uint8Array(w.bytes), pixelTag, new Uint8Array(pixelData.buffer as ArrayBuffer)],
    { type: 'application/dicom' }
  );

  return new File([blob], `demo_cbct_${String(sliceIndex + 1).padStart(3, '0')}.dcm`, {
    type: 'application/dicom',
  });
}

/**
 * Builds a jaw-shaped phantom: soft tissue envelope, a parabolic cortical and
 * trabecular arch, enamel-density teeth and a radiolucent mandibular canal.
 */
export async function generateDemoStudy(onProgress?: (pct: number) => void): Promise<File[]> {
  const slices = 120;
  const dim = 192;
  const sliceThickness = 0.5;
  const pixelSpacing = 0.4;
  const files: File[] = [];

  for (let s = 0; s < slices; s++) {
    const zNorm = (s - slices / 2) / (slices / 2);
    const pixels = new Int16Array(dim * dim);
    pixels.fill(-1000); // air

    for (let y = 0; y < dim; y++) {
      const ny = (y - dim / 2) / (dim / 2);
      for (let x = 0; x < dim; x++) {
        const nx = (x - dim / 2) / (dim / 2);
        const index = y * dim + x;

        const headDistance = Math.sqrt(nx * nx + (ny + 0.1) * (ny + 0.1));
        if (headDistance < 0.88) pixels[index] = 40; // soft tissue

        const jawY = 0.6 * nx * nx - 0.25;
        const distanceToArch = Math.abs(ny - jawY);

        if (distanceToArch < 0.18 && ny < 0.65 && ny > -0.75) {
          pixels[index] = 800; // cortical bone
          if (distanceToArch < 0.11) pixels[index] = 450; // trabecular bone

          if (Math.abs(zNorm) < 0.45) {
            const toothAngle = Math.atan2(ny, nx);
            if (Math.sin(toothAngle * 16) > 0.15) pixels[index] = 1950; // enamel
          }
        }

        if (zNorm < -0.1 && zNorm > -0.55 && distanceToArch < 0.045 && Math.abs(nx) > 0.25) {
          pixels[index] = -50; // mandibular canal
        }
      }
    }

    files.push(buildSlice(pixels, dim, s, slices, sliceThickness, pixelSpacing));

    if (s % 10 === 0) {
      onProgress?.(Math.round((s / slices) * 100));
      // Let the browser paint the progress bar.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onProgress?.(100);
  return files;
}
