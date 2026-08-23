import React, { useRef, useState } from 'react';
import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';
import JSZip from 'jszip';
import { Upload, FolderOpen, FileText, Archive, Sparkles, Loader2, AlertCircle } from 'lucide-react';

interface DicomUploaderProps {
  onImagesLoaded: (imageIds: string[]) => void;
}

interface FileMetadata {
  file: File;
  zPosition: number;
  instanceNumber: number;
  name: string;
}

export const DicomUploader: React.FC<DicomUploaderProps> = ({ onImagesLoaded }) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Helper to extract DICOM slice positioning for accurate 3D volume reconstruction
  const extractDicomMeta = async (file: File): Promise<FileMetadata> => {
    try {
      const headerBuffer = await file.slice(0, 4096).arrayBuffer();
      const byteArray = new Uint8Array(headerBuffer);
      const dataSet = dicomParser.parseDicom(byteArray);

      let zPosition = 0;
      const ippStr = dataSet.string('x00200032'); // ImagePositionPatient
      if (ippStr) {
        const coords = ippStr.split('\\').map(Number);
        if (coords.length === 3 && !isNaN(coords[2])) {
          zPosition = coords[2];
        }
      }

      const instanceNumber = dataSet.intString('x00200013') || 0; // InstanceNumber
      return { file, zPosition, instanceNumber, name: file.name };
    } catch {
      return { file, zPosition: 0, instanceNumber: 0, name: file.name };
    }
  };

  const processFiles = async (rawFiles: File[]) => {
    setError(null);
    setIsLoading(true);
    setProgress(0);
    setLoadingStatus('Фильтрация и проверка файлов...');

    // Filter out common non-DICOM OS clutter
    const validFiles = rawFiles.filter(f => {
      const name = f.name.toLowerCase();
      return !name.startsWith('.') && 
             !name.includes('thumbs.db') && 
             !name.endsWith('.xml') && 
             !name.endsWith('.txt') && 
             !name.endsWith('.json') && 
             !name.endsWith('.pdf') &&
             !name.endsWith('.png') &&
             !name.endsWith('.jpg');
    });

    if (validFiles.length === 0) {
      setError('В выбранном источнике не найдено подходящих файлов DICOM.');
      setIsLoading(false);
      return;
    }

    try {
      setLoadingStatus(`Считывание метаданных (${validFiles.length} файлов)...`);
      const metaList: FileMetadata[] = [];
      const total = validFiles.length;

      for (let i = 0; i < total; i++) {
        const meta = await extractDicomMeta(validFiles[i]);
        metaList.push(meta);
        if (i % 20 === 0 || i === total - 1) {
          setProgress(Math.round(((i + 1) / total) * 60));
        }
      }

      setLoadingStatus('Сортировка срезов по пространственным координатам...');
      // Sort by Z coordinate (or instance number fallback, or natural name sorting)
      metaList.sort((a, b) => {
        if (a.zPosition !== b.zPosition) {
          return a.zPosition - b.zPosition;
        }
        if (a.instanceNumber !== b.instanceNumber) {
          return a.instanceNumber - b.instanceNumber;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });

      setLoadingStatus('Регистрация DICOM в движке Cornerstone3D...');
      const imageIds: string[] = [];
      for (let i = 0; i < metaList.length; i++) {
        const imageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(metaList[i].file);
        imageIds.push(imageId);
        if (i % 20 === 0 || i === metaList.length - 1) {
          setProgress(60 + Math.round(((i + 1) / metaList.length) * 40));
        }
      }

      setLoadingStatus('Готово! Запуск реконструкции...');
      setTimeout(() => {
        onImagesLoaded(imageIds);
      }, 200);

    } catch (err: any) {
      console.error('Error processing DICOM files:', err);
      setError(err?.message || 'Ошибка при обработке файлов DICOM');
      setIsLoading(false);
    }
  };

  const handleZipFile = async (zipFile: File) => {
    setError(null);
    setIsLoading(true);
    setProgress(10);
    setLoadingStatus('Распаковка ZIP-архива в памяти...');

    try {
      const zip = new JSZip();
      const unzipped = await zip.loadAsync(zipFile);
      const extractedFiles: File[] = [];

      const entries = Object.keys(unzipped.files);
      let count = 0;

      for (const filename of entries) {
        const fileEntry = unzipped.files[filename];
        if (!fileEntry.dir) {
          const blob = await fileEntry.async('blob');
          const file = new File([blob], filename.split('/').pop() || filename);
          extractedFiles.push(file);
        }
        count++;
        if (count % 20 === 0) {
          setProgress(10 + Math.round((count / entries.length) * 30));
        }
      }

      await processFiles(extractedFiles);
    } catch (err: any) {
      console.error('Failed to unpack zip:', err);
      setError('Не удалось распаковать ZIP-архив. Убедитесь, что архив корректен.');
      setIsLoading(false);
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
  };

  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleZipFile(files[0]);
    }
  };

  // Drag & Drop Handler supporting folders, files, and zip
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) {
      if (e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
          handleZipFile(files[0]);
        } else {
          processFiles(files);
        }
      }
      return;
    }

    // Traverse directory tree if dropped a folder
    const collectedFiles: File[] = [];
    setIsLoading(true);
    setLoadingStatus('Чтение перетащенных объектов...');

    const readEntry = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file((file: File) => {
            collectedFiles.push(file);
            resolve();
          }, () => resolve());
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async (): Promise<void> => {
          return new Promise((resolve) => {
            dirReader.readEntries(async (entries: any[]) => {
              if (entries.length > 0) {
                for (const subEntry of entries) {
                  await readEntry(subEntry);
                }
                await readEntries(); // Continue reading until empty
              }
              resolve();
            }, () => resolve());
          });
        };
        await readEntries();
      }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null;
        if (entry) {
          await readEntry(entry);
        } else {
          const file = item.getAsFile();
          if (file) collectedFiles.push(file);
        }
      }
    }

    if (collectedFiles.length === 1 && collectedFiles[0].name.toLowerCase().endsWith('.zip')) {
      handleZipFile(collectedFiles[0]);
    } else {
      processFiles(collectedFiles);
    }
  };

  // Demo Scan Generator (Generates synthetic dental CBCT slices with a jaw arc & teeth)
  const generateDemoCBCT = async () => {
    setIsLoading(true);
    setProgress(0);
    setLoadingStatus('Генерация тестового КЛКТ скана (челюсть и зубы)...');

    const slicesCount = 120;
    const dim = 128; // 128x128 resolution for fast client-side demo generation
    const generatedFiles: File[] = [];

    for (let s = 0; s < slicesCount; s++) {
      const zNorm = (s - slicesCount / 2) / (slicesCount / 2); // -1 to 1
      const pixelData = new Int16Array(dim * dim);
      pixelData.fill(-1000); // Air (-1000 HU)

      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          const nx = (x - dim / 2) / (dim / 2);
          const ny = (y - dim / 2) / (dim / 2);
          const idx = y * dim + x;

          // Parabolic Mandible Bone Arc: y = a*x^2 + b
          const jawY = 0.55 * (nx * nx) - 0.2;
          const distToJaw = Math.abs(ny - jawY);

          // Soft tissue neck/face profile
          const headDist = Math.sqrt(nx * nx + (ny + 0.1) * (ny + 0.1));
          if (headDist < 0.85) {
            pixelData[idx] = 40; // Soft tissue (+40 HU)
          }

          // Jaw bone (Mandible / Maxilla)
          if (distToJaw < 0.16 && ny < 0.6 && ny > -0.7) {
            pixelData[idx] = 750; // Cortical/trabecular bone (+750 HU)

            // Teeth crowns & roots in the center slices
            if (Math.abs(zNorm) < 0.4) {
              const toothAngle = Math.atan2(ny, nx);
              if (Math.sin(toothAngle * 14) > 0.3) {
                pixelData[idx] = 1800; // Enamel / High Density Teeth (+1800 HU)
              }
            }
          }

          // Nerve canal in mandible (lower slices)
          if (zNorm < -0.1 && zNorm > -0.5 && distToJaw < 0.04) {
            pixelData[idx] = -30; // Mandibular nerve canal
          }
        }
      }

      // Minimal DICOM Part 10 Header
      const headerLength = 1024;
      const buffer = new ArrayBuffer(headerLength + pixelData.byteLength);
      const u8 = new Uint8Array(buffer);

      // Preamble at 128: 'DICM'
      u8[128] = 0x44; u8[129] = 0x49; u8[130] = 0x43; u8[131] = 0x4d;

      // Copy pixel data
      new Int16Array(buffer, headerLength).set(pixelData);

      // Construct a simple virtual file
      const fakeFile = new File([buffer], `demo_slice_${String(s).padStart(3, '0')}.dcm`, {
        type: 'application/dicom',
      });
      generatedFiles.push(fakeFile);

      if (s % 20 === 0) {
        setProgress(Math.round((s / slicesCount) * 80));
      }
    }

    setLoadingStatus('Инициализация тестовых проекций...');
    await processFiles(generatedFiles);
  };

  return (
    <div 
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`max-w-2xl w-full mx-auto bg-gray-900 border-2 ${
        isDragging ? 'border-blue-500 bg-gray-800 scale-[1.01]' : 'border-gray-700'
      } border-dashed rounded-2xl p-8 transition-all duration-200 shadow-2xl flex flex-col items-center text-center`}
    >
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderSelect}
        // @ts-ignore
        webkitdirectory=""
        // @ts-ignore
        directory=""
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={filesInputRef}
        onChange={handleFilesSelect}
        multiple
        accept=".dcm,application/dicom"
        className="hidden"
      />
      <input
        type="file"
        ref={zipInputRef}
        onChange={handleZipSelect}
        accept=".zip,application/zip"
        className="hidden"
      />

      {/* Main Upload Content */}
      <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-full flex items-center justify-center mb-4 ring-8 ring-blue-500/10">
        <Upload className="w-8 h-8" />
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">
        Загрузка КЛКТ (DICOM) исследования
      </h2>
      <p className="text-gray-400 text-sm max-w-md mb-6">
        Перетащите сюда папку, файлы <code>.dcm</code> или <code>.zip</code> архив. Все данные обрабатываются на 100% локально в браузере.
      </p>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mb-6">
        <button
          disabled={isLoading}
          onClick={() => folderInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-lg hover:shadow-blue-500/25"
        >
          <FolderOpen className="w-4 h-4" />
          Выбрать папку
        </button>

        <button
          disabled={isLoading}
          onClick={() => filesInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-all"
        >
          <FileText className="w-4 h-4" />
          Выбрать файлы
        </button>

        <button
          disabled={isLoading}
          onClick={() => zipInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-all"
        >
          <Archive className="w-4 h-4" />
          ZIP-архив
        </button>
      </div>

      {/* Demo Button */}
      <div className="w-full pt-4 border-t border-gray-800 flex flex-col items-center">
        <button
          disabled={isLoading}
          onClick={generateDemoCBCT}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-all"
        >
          <Sparkles className="w-4 h-4" />
          Нет файла? Загрузить тестовую КЛКТ модель челюсти
        </button>
      </div>

      {/* Loading Progress State */}
      {isLoading && (
        <div className="mt-6 w-full bg-gray-800/80 rounded-xl p-4 border border-blue-500/30 animate-pulse">
          <div className="flex items-center justify-between text-xs text-blue-400 mb-2 font-medium">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {loadingStatus}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-200 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2 text-left">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
