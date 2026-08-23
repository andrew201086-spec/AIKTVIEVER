import React, { useEffect, useRef, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { 
  ZoomIn, 
  Move, 
  SunMedium, 
  Layers, 
  RotateCcw, 
  Cylinder, 
  Activity
} from 'lucide-react';

const {
  RenderingEngine,
  Enums: { ViewportType, OrientationAxis },
  volumeLoader,
  setVolumesForViewports,
  cache,
} = cornerstone;

const {
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollMouseWheelTool,
  ToolGroupManager,
  Enums: { MouseBindings },
} = cornerstoneTools;

interface ViewerProps {
  imageIds: string[];
}

const RENDERING_ENGINE_ID = 'cbctRenderingEngine';
const VOLUME_ID = 'cornerstoneVolume_main';
const TOOL_GROUP_ID = 'cbctToolGroup';

const VIEWPORT_IDS = {
  AXIAL: 'axialViewport',
  SAGITTAL: 'sagittalViewport',
  CORONAL: 'coronalViewport',
  VOLUME3D: 'volume3dViewport',
};

// Safe helper to register tools only once
const registerToolsOnce = () => {
  const tools = [PanTool, ZoomTool, WindowLevelTool, StackScrollMouseWheelTool];
  tools.forEach(tool => {
    try {
      cornerstoneTools.addTool(tool);
    } catch {
      // Tool already added
    }
  });
};

export const Viewer: React.FC<ViewerProps> = ({ imageIds }) => {
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const volume3dRef = useRef<HTMLDivElement>(null);

  const [activeTool, setActiveTool] = useState<'WindowLevel' | 'Pan' | 'Zoom'>('WindowLevel');
  const [activePreset, setActivePreset] = useState<string>('CT-Bone');
  const [implantSize, setImplantSize] = useState({ diameter: 4.0, length: 10.0 });
  const [isImplantMode, setIsImplantMode] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [isVolumeLoaded, setIsVolumeLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const renderingEngineRef = useRef<cornerstone.RenderingEngine | null>(null);

  useEffect(() => {
    let renderingEngine: cornerstone.RenderingEngine;
    let isCancelled = false;

    const setupViewer = async () => {
      try {
        setErrorMsg(null);
        setIsVolumeLoaded(false);
        setLoadingProgress(10);

        // 1. Safe registration of tools
        registerToolsOnce();

        // 2. Cleanup old rendering engine & tool group if existing
        const oldToolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
        if (oldToolGroup) {
          ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
        }

        // 3. Create Rendering Engine
        renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
        renderingEngineRef.current = renderingEngine;

        // 4. Define 2x2 Viewports
        const viewportInputs = [
          {
            viewportId: VIEWPORT_IDS.AXIAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: axialRef.current!,
            defaultOptions: {
              orientation: OrientationAxis.AXIAL,
              background: [0.05, 0.05, 0.05] as cornerstone.Types.Point3,
            },
          },
          {
            viewportId: VIEWPORT_IDS.SAGITTAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: sagittalRef.current!,
            defaultOptions: {
              orientation: OrientationAxis.SAGITTAL,
              background: [0.05, 0.05, 0.05] as cornerstone.Types.Point3,
            },
          },
          {
            viewportId: VIEWPORT_IDS.CORONAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: coronalRef.current!,
            defaultOptions: {
              orientation: OrientationAxis.CORONAL,
              background: [0.05, 0.05, 0.05] as cornerstone.Types.Point3,
            },
          },
          {
            viewportId: VIEWPORT_IDS.VOLUME3D,
            type: ViewportType.VOLUME_3D,
            element: volume3dRef.current!,
            defaultOptions: {
              background: [0.08, 0.08, 0.1] as cornerstone.Types.Point3,
            },
          },
        ];

        renderingEngine.setViewports(viewportInputs);

        // 5. Setup and configure ToolGroup
        const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
        if (toolGroup) {
          toolGroup.addTool(PanTool.toolName);
          toolGroup.addTool(ZoomTool.toolName);
          toolGroup.addTool(WindowLevelTool.toolName);
          toolGroup.addTool(StackScrollMouseWheelTool.toolName);

          // Default bindings: Left click = WindowLevel, Middle = Pan, Right = Zoom, Wheel = Scroll
          toolGroup.setToolActive(WindowLevelTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
          });
          toolGroup.setToolActive(PanTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Auxiliary }],
          });
          toolGroup.setToolActive(ZoomTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Secondary }],
          });
          toolGroup.setToolActive(StackScrollMouseWheelTool.toolName);

          // Attach all 4 viewports to the tool group
          Object.values(VIEWPORT_IDS).forEach((id) => {
            toolGroup.addViewport(id, RENDERING_ENGINE_ID);
          });
        }

        setLoadingProgress(40);

        // 6. Build and cache the 3D volume
        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, {
          imageIds,
        });

        if (isCancelled) return;

        setLoadingProgress(70);

        // 7. Load volume into memory
        volume.load();

        // 8. Bind Volume to all Viewports
        await setVolumesForViewports(
          renderingEngine,
          [{ volumeId: VOLUME_ID }],
          [
            VIEWPORT_IDS.AXIAL,
            VIEWPORT_IDS.SAGITTAL,
            VIEWPORT_IDS.CORONAL,
            VIEWPORT_IDS.VOLUME3D,
          ]
        );

        if (isCancelled) return;

        // 9. Apply 3D Preset (Bone / Teeth)
        const volume3dViewport = renderingEngine.getViewport(
          VIEWPORT_IDS.VOLUME3D
        ) as cornerstone.Types.IVolumeViewport;

        if (volume3dViewport && volume3dViewport.setProperties) {
          try {
            volume3dViewport.setProperties({
              preset: 'CT-Bone',
            });
          } catch {
            // Preset fallback
          }
        }

        // 10. Trigger Initial Render
        renderingEngine.render();
        setIsVolumeLoaded(true);
        setLoadingProgress(100);

      } catch (err: any) {
        console.error('Failed to initialize 3D viewports:', err);
        if (!isCancelled) {
          setErrorMsg(err?.message || 'Ошибка инициализации 3D реконструкции');
        }
      }
    };

    setupViewer();

    return () => {
      isCancelled = true;
      if (renderingEngineRef.current) {
        try {
          renderingEngineRef.current.destroy();
        } catch {}
      }
      try {
        ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      } catch {}
      try {
        cache.purgeCache();
      } catch {}
    };
  }, [imageIds]);

  // Handle Tool Switch
  const switchTool = (toolName: 'WindowLevel' | 'Pan' | 'Zoom') => {
    const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (!toolGroup) return;

    setActiveTool(toolName);

    // Passive everything first
    toolGroup.setToolPassive(WindowLevelTool.toolName);
    toolGroup.setToolPassive(PanTool.toolName);
    toolGroup.setToolPassive(ZoomTool.toolName);

    if (toolName === 'WindowLevel') {
      toolGroup.setToolActive(WindowLevelTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'Pan') {
      toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    } else if (toolName === 'Zoom') {
      toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
      });
    }
  };

  // Reset Camera Views
  const resetViews = () => {
    if (!renderingEngineRef.current) return;
    Object.values(VIEWPORT_IDS).forEach((viewportId) => {
      const vp = renderingEngineRef.current?.getViewport(viewportId);
      if (vp) {
        vp.resetCamera();
        vp.render();
      }
    });
  };

  // Change 3D Preset
  const changePreset = (preset: string) => {
    setActivePreset(preset);
    if (!renderingEngineRef.current) return;
    const vp = renderingEngineRef.current.getViewport(VIEWPORT_IDS.VOLUME3D) as cornerstone.Types.IVolumeViewport;
    if (vp && vp.setProperties) {
      vp.setProperties({ preset });
      vp.render();
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-black text-white select-none">
      {/* Top Toolbar */}
      <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 justify-between gap-4 z-10">
        {/* Navigation & Measurement Tools */}
        <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700">
          <button
            onClick={() => switchTool('WindowLevel')}
            title="Яркость / Контраст (HU Window/Level)"
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTool === 'WindowLevel' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <SunMedium className="w-3.5 h-3.5" />
            <span>W/L (Кость)</span>
          </button>

          <button
            onClick={() => switchTool('Pan')}
            title="Панорамирование (Pan)"
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTool === 'Pan' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Move className="w-3.5 h-3.5" />
            <span>Сдвиг</span>
          </button>

          <button
            onClick={() => switchTool('Zoom')}
            title="Масштаб (Zoom)"
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTool === 'Zoom' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
            }`}
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span>Масштаб</span>
          </button>
        </div>

        {/* Dental Implant Planning Bar */}
        <div className="flex items-center gap-2 bg-gray-800/80 px-3 py-1 rounded-lg border border-gray-700">
          <button
            onClick={() => setIsImplantMode(!isImplantMode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-all ${
              isImplantMode 
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30' 
                : 'bg-gray-700 text-emerald-400 hover:bg-gray-600'
            }`}
          >
            <Cylinder className="w-3.5 h-3.5" />
            <span>Имплантат 3D</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-gray-300 pl-2 border-l border-gray-700">
            <label className="flex items-center gap-1">
              <span className="text-gray-400">Ø:</span>
              <select 
                value={implantSize.diameter} 
                onChange={(e) => setImplantSize({ ...implantSize, diameter: parseFloat(e.target.value) })}
                className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white"
              >
                <option value="3.0">3.0 mm</option>
                <option value="3.5">3.5 mm</option>
                <option value="4.0">4.0 mm</option>
                <option value="4.5">4.5 mm</option>
                <option value="5.0">5.0 mm</option>
              </select>
            </label>

            <label className="flex items-center gap-1">
              <span className="text-gray-400">L:</span>
              <select 
                value={implantSize.length} 
                onChange={(e) => setImplantSize({ ...implantSize, length: parseFloat(e.target.value) })}
                className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white"
              >
                <option value="8.0">8.0 mm</option>
                <option value="10.0">10.0 mm</option>
                <option value="11.5">11.5 mm</option>
                <option value="13.0">13.0 mm</option>
                <option value="15.0">15.0 mm</option>
              </select>
            </label>
          </div>
        </div>

        {/* 3D Presets & Reset */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Layers className="w-3.5 h-3.5" />
            <span>3D:</span>
            <select
              value={activePreset}
              onChange={(e) => changePreset(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
            >
              <option value="CT-Bone">Кость (Bone)</option>
              <option value="CT-Chest-Contrast-Enhanced">Мягкие ткани + Кость</option>
              <option value="CT-MIP">MIP (Макс. интенсивность)</option>
            </select>
          </div>

          <button
            onClick={resetViews}
            title="Сброс положения камер"
            className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-xs flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2x2 Viewports Grid */}
      <div className="flex-grow grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5 bg-black relative">
        {/* Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center p-6">
            <div className="bg-red-950/80 border border-red-500 rounded-xl p-6 max-w-md text-center">
              <Activity className="w-8 h-8 text-red-400 mx-auto mb-2 animate-bounce" />
              <h3 className="text-lg font-bold text-red-200 mb-1">Ошибка рендеринга</h3>
              <p className="text-xs text-red-300 mb-4">{errorMsg}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-xs font-semibold"
              >
                Перезагрузить
              </button>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {!isVolumeLoaded && !errorMsg && (
          <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-blue-400">
              Построение 3D объема ({loadingProgress}%)...
            </p>
          </div>
        )}

        {/* 1. AXIAL VIEWPORT */}
        <div className="relative bg-gray-950 border border-blue-900/40 rounded-lg overflow-hidden flex flex-col">
          <div ref={axialRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2.5 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded border border-blue-500/30 text-blue-400 font-mono text-xs pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            АКСИАЛЬНАЯ (AXIAL)
          </div>
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 font-mono pointer-events-none">
            Колесо: Срез | ЛКМ: {activeTool}
          </div>
        </div>

        {/* 2. SAGITTAL VIEWPORT */}
        <div className="relative bg-gray-950 border border-emerald-900/40 rounded-lg overflow-hidden flex flex-col">
          <div ref={sagittalRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2.5 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 font-mono text-xs pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            САГИТТАЛЬНАЯ (SAGITTAL)
          </div>
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 font-mono pointer-events-none">
            Колесо: Срез | ЛКМ: {activeTool}
          </div>
        </div>

        {/* 3. CORONAL VIEWPORT */}
        <div className="relative bg-gray-950 border border-rose-900/40 rounded-lg overflow-hidden flex flex-col">
          <div ref={coronalRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2.5 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded border border-rose-500/30 text-rose-400 font-mono text-xs pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            КОРОНАЛЬНАЯ (CORONAL)
          </div>
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 font-mono pointer-events-none">
            Колесо: Срез | ЛКМ: {activeTool}
          </div>
        </div>

        {/* 4. 3D VOLUME VIEWPORT */}
        <div className="relative bg-gray-950 border border-amber-900/40 rounded-lg overflow-hidden flex flex-col">
          <div ref={volume3dRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2.5 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 font-mono text-xs pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            3D ОБЪЕМ (VOLUME)
          </div>
          <div className="absolute bottom-2 right-2 text-[10px] text-amber-400/60 font-mono pointer-events-none">
            ЛКМ: Вращение | ПКМ: Зум
          </div>
        </div>
      </div>
    </div>
  );
};
