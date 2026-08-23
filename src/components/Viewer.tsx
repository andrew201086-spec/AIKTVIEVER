import React, { useEffect, useRef } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

const {
  RenderingEngine,
  Enums: { ViewportType },
  volumeLoader,
  setVolumesForViewports,
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

const RENDERING_ENGINE_ID = 'myRenderingEngine';
const VOLUME_ID = 'cornerstoneVolume';
const TOOL_GROUP_ID = 'myToolGroup';

const VIEWPORT_IDS = {
  AXIAL: 'axialViewport',
  SAGITTAL: 'sagittalViewport',
  CORONAL: 'coronalViewport',
  VOLUME3D: 'volume3dViewport',
};

export const Viewer: React.FC<ViewerProps> = ({ imageIds }) => {
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const volume3dRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let renderingEngine: cornerstone.RenderingEngine;
    let volume: any;

    const setup = async () => {
      // 1. Create Rendering Engine
      renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);

      // 2. Define Viewports
      const viewportInputs = [
        {
          viewportId: VIEWPORT_IDS.AXIAL,
          type: ViewportType.ORTHOGRAPHIC,
          element: axialRef.current!,
          defaultOptions: {
            orientation: cornerstone.Enums.OrientationAxis.AXIAL,
          },
        },
        {
          viewportId: VIEWPORT_IDS.SAGITTAL,
          type: ViewportType.ORTHOGRAPHIC,
          element: sagittalRef.current!,
          defaultOptions: {
            orientation: cornerstone.Enums.OrientationAxis.SAGITTAL,
          },
        },
        {
          viewportId: VIEWPORT_IDS.CORONAL,
          type: ViewportType.ORTHOGRAPHIC,
          element: coronalRef.current!,
          defaultOptions: {
            orientation: cornerstone.Enums.OrientationAxis.CORONAL,
          },
        },
        {
          viewportId: VIEWPORT_IDS.VOLUME3D,
          type: ViewportType.VOLUME_3D,
          element: volume3dRef.current!,
          defaultOptions: {
            background: [0.1, 0.1, 0.1] as cornerstone.Types.Point3,
          },
        },
      ];
      renderingEngine.setViewports(viewportInputs);

      // 3. Setup Tools
      cornerstoneTools.addTool(PanTool);
      cornerstoneTools.addTool(ZoomTool);
      cornerstoneTools.addTool(WindowLevelTool);
      cornerstoneTools.addTool(StackScrollMouseWheelTool);

      const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
      if (toolGroup) {
        toolGroup.addTool(PanTool.toolName);
        toolGroup.addTool(ZoomTool.toolName);
        toolGroup.addTool(WindowLevelTool.toolName);
        toolGroup.addTool(StackScrollMouseWheelTool.toolName);

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

        // Bind tool group to all viewports
        Object.values(VIEWPORT_IDS).forEach((id) => {
          toolGroup.addViewport(id, RENDERING_ENGINE_ID);
        });
      }

      // 4. Create and load volume
      volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, {
        imageIds,
      });

      // 5. Load volume data and wait for it
      volume.load();

      // 6. Set volume to viewports
      await setVolumesForViewports(
        renderingEngine,
        [{ volumeId: VOLUME_ID }],
        [VIEWPORT_IDS.AXIAL, VIEWPORT_IDS.SAGITTAL, VIEWPORT_IDS.CORONAL, VIEWPORT_IDS.VOLUME3D]
      );

      // Set 3D preset for bone
      const volume3dViewport = renderingEngine.getViewport(VIEWPORT_IDS.VOLUME3D) as cornerstone.Types.IVolumeViewport;
      if (volume3dViewport) {
        // Simple preset for Bone (Hounsfield Units ~ 300 to 1500)
        volume3dViewport.setProperties({
          preset: 'CT-Bone', 
        });
      }

      // 7. Render
      renderingEngine.renderViewports([
        VIEWPORT_IDS.AXIAL,
        VIEWPORT_IDS.SAGITTAL,
        VIEWPORT_IDS.CORONAL,
        VIEWPORT_IDS.VOLUME3D,
      ]);
    };

    setup();

    return () => {
      // Cleanup
      if (renderingEngine) {
        renderingEngine.destroy();
      }
      ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID);
      cornerstone.cache.purgeCache();
    };
  }, [imageIds]);

  return (
    <div className="w-full h-full flex flex-col bg-black p-2" ref={containerRef}>
      <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-grow h-full">
        <div className="relative border border-gray-700 rounded overflow-hidden">
          <div ref={axialRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2 text-green-400 font-mono text-sm pointer-events-none">AXIAL</div>
        </div>
        <div className="relative border border-gray-700 rounded overflow-hidden">
          <div ref={sagittalRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2 text-blue-400 font-mono text-sm pointer-events-none">SAGITTAL</div>
        </div>
        <div className="relative border border-gray-700 rounded overflow-hidden">
          <div ref={coronalRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2 text-red-400 font-mono text-sm pointer-events-none">CORONAL</div>
        </div>
        <div className="relative border border-gray-700 rounded overflow-hidden">
          <div ref={volume3dRef} className="w-full h-full" onContextMenu={(e) => e.preventDefault()} />
          <div className="absolute top-2 left-2 text-yellow-400 font-mono text-sm pointer-events-none">3D VOLUME</div>
        </div>
      </div>
    </div>
  );
};
