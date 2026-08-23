import React, { useRef } from 'react';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';

interface DicomUploaderProps {
  onImagesLoaded: (imageIds: string[]) => void;
}

export const DicomUploader: React.FC<DicomUploaderProps> = ({ onImagesLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const imageIds: string[] = [];
    
    // Sort files by name (or ideally by InstanceNumber/SliceLocation parsed from DICOM)
    // For MVP, simple sort by filename assuming they are numbered
    const sortedFiles = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    for (const file of sortedFiles) {
      // Create a cornerstone image id using the file loader
      const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);
      imageIds.push(imageId);
    }
    
    if (imageIds.length > 0) {
      onImagesLoaded(imageIds);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-900 border-2 border-dashed border-gray-600 rounded-lg p-12">
      <h2 className="text-2xl font-bold mb-4 text-white">Upload CBCT DICOM Folder</h2>
      <p className="text-gray-400 mb-6 text-center">
        Select a folder containing your DICOM (.dcm) files. <br/>
        Files are processed entirely in the browser.
      </p>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        // @ts-ignore - webkitdirectory is non-standard but widely supported
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
      />
      
      <button 
        onClick={() => fileInputRef.current?.click()}
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow-md transition-colors"
      >
        Select Folder
      </button>
    </div>
  );
};
