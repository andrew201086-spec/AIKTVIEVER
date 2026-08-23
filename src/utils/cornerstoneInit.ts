import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';

let initialized = false;

export async function initCornerstone() {
  if (initialized) return;

  // Initialize @cornerstonejs/core
  await cornerstone.init();
  
  // Initialize @cornerstonejs/tools
  await cornerstoneTools.init();

  // Configure dicom-image-loader
  cornerstoneDICOMImageLoader.external.cornerstone = cornerstone;
  cornerstoneDICOMImageLoader.external.dicomParser = dicomParser;
  
  const maxWebWorkers = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 7) : 1;
  const maxSynchronousRequests = 1;

  cornerstoneDICOMImageLoader.configure({
    useWebWorkers: true,
    decodeConfig: {
      convertFloatPixelDataToInt: false,
    },
  });

  const config = {
    maxWebWorkers,
    startWebWorkersOnDemand: true,
    taskConfiguration: {
      decodeTask: {
        initializeCodecsOnStartup: false,
        usePDFJS: false,
        strict: false,
      },
    },
  };

  cornerstoneDICOMImageLoader.webWorkerManager.initialize(config);
  
  initialized = true;
  console.log('Cornerstone 3D initialized');
}
