import { useState, useEffect } from 'react';
import { DicomUploader } from './components/DicomUploader';
import { Viewer } from './components/Viewer';
import { initCornerstone } from './utils/cornerstoneInit';

function App() {
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const setup = async () => {
      try {
        await initCornerstone();
        setIsReady(true);
      } catch (e) {
        console.error('Failed to initialize cornerstone', e);
      }
    };
    setup();
  }, []);

  if (!isReady) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white">
        <p className="text-xl animate-pulse">Initializing Medical Engine...</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex flex-col">
      {/* Header */}
      <div className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 flex-shrink-0">
        <h1 className="text-white font-semibold flex items-center gap-2">
          <span className="text-blue-500 text-xl">🦷</span> CBCT Implant Planner
        </h1>
        {imageIds.length > 0 && (
          <button 
            onClick={() => setImageIds([])}
            className="ml-auto text-sm bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-white"
          >
            Close Patient
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-grow relative">
        {imageIds.length === 0 ? (
          <div className="absolute inset-0 p-8 flex items-center justify-center">
             <DicomUploader onImagesLoaded={setImageIds} />
          </div>
        ) : (
          <Viewer imageIds={imageIds} />
        )}
      </div>
    </div>
  );
}

export default App;
