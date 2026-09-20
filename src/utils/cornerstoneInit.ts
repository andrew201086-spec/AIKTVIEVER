import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/streaming-image-volume-loader';
import dicomParser from 'dicom-parser';
import { registerCustomMetadataProvider } from './customMetadataProvider';
import { hasNorm16Textures } from './renderCapabilities';

/**
 * Single-flight init. A plain boolean guard is not enough: React StrictMode
 * mounts effects twice in development, both calls enter before the first await
 * resolves, and every loader and metadata provider ends up registered twice.
 */
let initPromise: Promise<void> | null = null;

export function initCornerstone(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      // Let the next attempt retry instead of caching a rejected promise.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  await cornerstone.init({
    isMobile: false,
    detectGPUConfig: {},
    enableCacheOptimization: true,
    rendering: {
      useCPURendering: false,
      // Two different 16-bit paths, and only one of them is safe.
      //
      // preferSizeOverAccuracy switches the volume to half-float, which in
      // this version renders a band at the bottom of every slice wrong and
      // loses precision above 2048 HU — right where enamel lives. Off.
      //
      // useNorm16Texture stores the volume as normalised 16-bit integers:
      // same halving of memory, exact Hounsfield units, no band. That is what
      // lets a full 734-slice CBCT fit on the GPU instead of being thinned
      // out. Enabled whenever the extension is there, float32 otherwise.
      preferSizeOverAccuracy: false,
      useNorm16Texture: hasNorm16Textures(),
      // CBCT exports frequently carry sub-micron jitter in slice positions.
      // Refusing to open them is worse than opening them; we measure the
      // spacing ourselves in dicomParse and warn when it is genuinely uneven.
      strictZSpacingForVolumeViewport: false,
    },
  });

  // Cornerstone defaults to assuming SharedArrayBuffer is available and then
  // throws when it is not — which is every static host that cannot send
  // cross-origin isolation headers, GitHub Pages included. AUTO detects it and
  // falls back to a plain ArrayBuffer instead of failing to open the study.
  cornerstone.setUseSharedArrayBuffer(cornerstone.Enums.SharedArrayBufferModes.AUTO);

  await cornerstoneTools.init();

  cornerstone.volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingImageVolume',
    cornerstoneStreamingImageVolumeLoader as any
  );
  cornerstone.volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader as any
  );
  cornerstone.volumeLoader.registerUnknownVolumeLoader(
    cornerstoneStreamingImageVolumeLoader as any
  );

  cornerstoneDICOMImageLoader.external.cornerstone = cornerstone;
  cornerstoneDICOMImageLoader.external.dicomParser = dicomParser;

  // register() wires up the image loaders for the wadouri / dicomfile /
  // dicomweb schemes together with the matching metadata provider. Doing it by
  // hand is where the previous version went wrong: the provider lives at
  // wadouri.metaData.metaDataProvider, so a guard on wadouri.metaDataProvider
  // was always false and no provider was ever registered.
  cornerstoneDICOMImageLoader.wadouri.register(cornerstone);
  cornerstoneDICOMImageLoader.wadors.register(cornerstone);

  // Ours answers first: for local files we parse the headers up front, before
  // any pixel data is decoded, and the volume loader needs that geometry to
  // size the volume.
  registerCustomMetadataProvider(100000);

  const { preferSizeOverAccuracy, useNorm16Texture } = cornerstone.getConfiguration().rendering;

  cornerstoneDICOMImageLoader.configure({
    useWebWorkers: true,
    decodeConfig: {
      convertFloatPixelDataToInt: false,
      use16BitDataType: preferSizeOverAccuracy || useNorm16Texture,
    },
  });

  // Decoding 600+ CBCT slices on the main thread freezes the tab for minutes.
  // Leave one core for the UI and the renderer.
  const cores = navigator.hardwareConcurrency || 2;
  const maxWebWorkers = Math.max(1, Math.min(cores - 1, 7));

  cornerstoneDICOMImageLoader.webWorkerManager.initialize({
    maxWebWorkers,
    startWebWorkersOnDemand: true,
    taskConfiguration: {
      decodeTask: {
        initializeCodecsOnStartup: false,
        strict: false,
      },
    },
  });

  console.log(
    `Cornerstone3D готов · web-workers: ${maxWebWorkers} · SharedArrayBuffer: ${
      cornerstone.getShouldUseSharedArrayBuffer() ? "да" : "нет"
    }`
  );
}
