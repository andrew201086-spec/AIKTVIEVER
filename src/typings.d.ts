declare module '@cornerstonejs/dicom-image-loader' {
  const cornerstoneDICOMImageLoader: any;
  export default cornerstoneDICOMImageLoader;
}
declare module 'dicom-parser' {
  const dicomParser: any;
  export default dicomParser;
}

/**
 * vtk.js ships types for most of itself, but not for every entry point this
 * viewer reaches into. These four are used directly — the clipping planes on
 * the 3D mapper and the surface export — and their shapes are checked at the
 * point of use.
 */
declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  const vtkImageMarchingCubes: any;
  export default vtkImageMarchingCubes;
}
declare module '@kitware/vtk.js/IO/Geometry/STLWriter' {
  const vtkSTLWriter: any;
  export default vtkSTLWriter;
}
