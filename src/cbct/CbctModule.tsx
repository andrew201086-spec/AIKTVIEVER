import { useEffect, useState } from 'react';
import { DicomUploader } from '../components/DicomUploader';
import { Viewer } from '../components/Viewer';
import { initCornerstone } from '../utils/cornerstoneInit';

/** КЛКТ-модуль: объёмная реконструкция DICOM и планирование по кости. */
export const CbctModule = () => {
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initCornerstone()
      .then(() => !cancelled && setIsReady(true))
      .catch((e) => {
        console.error('Failed to initialize cornerstone', e);
        if (!cancelled) setError('Не удалось инициализировать движок КЛКТ');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-red-400">
        {error}
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-white">
        <p className="animate-pulse text-lg">Инициализация КЛКТ-движка…</p>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-black">
      {imageIds.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <DicomUploader onImagesLoaded={setImageIds} />
        </div>
      ) : (
        <Viewer imageIds={imageIds} />
      )}
    </div>
  );
};
