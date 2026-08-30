import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Measurement, Restoration, ScanMeta, ViewPreset } from '../types';
import { useScanStore } from '../store';
import { getScan } from '../mesh/registry';
import { nearestTooth, occlusalAxis, placeOnTooth } from '../mesh/placement';
import { restorationGeometry } from '../geometry/factory';
import { buildConnectorGeometry } from '../geometry/bridge';
import { restorationMaterial } from '../data/materials';
import { archOrderIndex } from '../data/fdi';
import { PRESET_DIRECTIONS, viewportApi } from './viewport';

const SCAN_COLOR = '#e6ddd0';

/** Everything is authored in millimetres; the camera is set up to match. */
const CAMERA = { fov: 32, near: 1, far: 2000, position: [0, 40, 150] as const };

const useClippingPlanes = (): THREE.Plane[] => {
  const clip = useScanStore((s) => s.clip);
  return useMemo(() => {
    if (!clip.enabled) return [];
    const normal = new THREE.Vector3(
      clip.axis === 'x' ? 1 : 0,
      clip.axis === 'y' ? 1 : 0,
      clip.axis === 'z' ? 1 : 0,
    );
    if (clip.flip) normal.negate();
    return [new THREE.Plane(normal, -clip.offset * (clip.flip ? -1 : 1))];
  }, [clip]);
};

const Lighting = () => {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    return () => {
      environment.texture.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);

  return (
    <>
      <hemisphereLight args={['#ffffff', '#41474f', 0.55]} />
      <directionalLight position={[60, 120, 90]} intensity={1.5} />
      <directionalLight position={[-80, 40, -60]} intensity={0.5} />
      <directionalLight position={[0, -110, 40]} intensity={0.45} />
    </>
  );
};

const ViewportBridge = () => {
  const { camera, gl, scene, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target: THREE.Vector3; update: () => void })
    | null;

  useEffect(() => {
    const sceneBounds = () => {
      const box = new THREE.Box3();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.userData.jaw) box.expandByObject(mesh);
      });
      if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(60, 40, 60));
      return box;
    };

    const moveTo = (direction: THREE.Vector3) => {
      const box = sceneBounds();
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(20, box.getSize(new THREE.Vector3()).length() / 2);
      const perspective = camera as THREE.PerspectiveCamera;
      const distance = (radius * 1.5) / Math.tan((perspective.fov * Math.PI) / 360);
      const unit = direction.clone().normalize();
      camera.position.copy(centre).addScaledVector(unit, distance);
      // Looking straight down the arch needs an explicit up vector.
      if (Math.abs(unit.y) > 0.9) camera.up.set(0, 0, unit.y > 0 ? -1 : 1);
      else camera.up.set(0, 1, 0);
      camera.lookAt(centre);
      if (controls) {
        controls.target.copy(centre);
        controls.update();
      }
      invalidate();
    };

    viewportApi.current = {
      setPreset: (preset: ViewPreset) => moveTo(PRESET_DIRECTIONS[preset].clone()),
      orbitTo: moveTo,
      frameAll: () => moveTo(camera.position.clone().sub(sceneBounds().getCenter(new THREE.Vector3()))),
      capture: () => {
        gl.render(scene, camera);
        try {
          return gl.domElement.toDataURL('image/png');
        } catch {
          return null;
        }
      },
    };
    return () => {
      viewportApi.current = null;
    };
  }, [camera, controls, gl, invalidate, scene]);

  return null;
};

interface JawModelProps {
  meta: ScanMeta;
  planes: THREE.Plane[];
  onPick: (event: ThreeEvent<MouseEvent>, meta: ScanMeta) => void;
}

const JawModel = ({ meta, planes, onPick }: JawModelProps) => {
  const record = getScan(meta.id);
  if (!record || !meta.visible) return null;

  return (
    <mesh
      geometry={record.geometry}
      userData={{ jaw: meta.jaw }}
      onPointerDown={(event) => onPick(event, meta)}
    >
      <meshStandardMaterial
        vertexColors={meta.hasVertexColors}
        color={meta.hasVertexColors ? '#ffffff' : SCAN_COLOR}
        roughness={0.62}
        metalness={0.02}
        transparent={meta.opacity < 1}
        opacity={meta.opacity}
        depthWrite={meta.opacity > 0.95}
        clippingPlanes={planes}
        clipIntersection={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

interface RestorationViewProps {
  item: Restoration;
  selected: boolean;
  planes: THREE.Plane[];
  onSelect: (id: string) => void;
  registerRef: (id: string, object: THREE.Object3D | null) => void;
}

const RestorationView = ({
  item,
  selected,
  planes,
  onSelect,
  registerRef,
}: RestorationViewProps) => {
  const geometry = useMemo(() => restorationGeometry(item), [item]);
  const material = useMemo(
    () => restorationMaterial(item.material, selected),
    [item.material, selected],
  );
  // A fresh arrow here would make React re-run the ref on every render, and the
  // version bump inside it would loop.
  const setRef = useCallback(
    (node: THREE.Object3D | null) => registerRef(item.id, node),
    [item.id, registerRef],
  );

  useEffect(() => {
    material.clippingPlanes = planes;
    material.needsUpdate = true;
  }, [material, planes]);

  if (!item.visible) return null;

  return (
    <group
      ref={setRef}
      position={item.transform.position}
      rotation={item.transform.rotation}
      scale={item.transform.scale}
    >
      <mesh
        geometry={geometry}
        material={material}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect(item.id);
        }}
      />
    </group>
  );
};

const worldContactPoint = (item: Restoration): THREE.Vector3 => {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...item.transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...item.transform.rotation)),
    new THREE.Vector3(...item.transform.scale),
  );
  return new THREE.Vector3(0, item.params.height * 0.45, 0).applyMatrix4(matrix);
};

const BridgeConnectors = ({
  restorations,
  planes,
}: {
  restorations: Restoration[];
  planes: THREE.Plane[];
}) => {
  const groups = useMemo(() => {
    const map = new Map<string, Restoration[]>();
    restorations.forEach((item) => {
      if (!item.bridgeId || !item.visible) return;
      const list = map.get(item.bridgeId) ?? [];
      list.push(item);
      map.set(item.bridgeId, list);
    });
    return [...map.values()]
      .map((list) =>
        list.slice().sort((a, b) => archOrderIndex(a.tooth) - archOrderIndex(b.tooth)),
      )
      .filter((list) => list.length > 1);
  }, [restorations]);

  const connectors = useMemo(
    () =>
      groups.flatMap((list) =>
        list.slice(0, -1).map((item, index) => {
          const next = list[index + 1];
          const up = occlusalAxis(item.jaw);
          return {
            key: `${item.id}-${next.id}`,
            material: item.material,
            geometry: buildConnectorGeometry(
              worldContactPoint(item),
              worldContactPoint(next),
              up,
              Math.min(item.params.height, next.params.height) * 0.45,
              Math.min(item.params.depth, next.params.depth) * 0.42,
            ),
          };
        }),
      ),
    [groups],
  );

  useEffect(
    () => () => connectors.forEach((connector) => connector.geometry.dispose()),
    [connectors],
  );

  return (
    <>
      {connectors.map((connector) => {
        const material = restorationMaterial(connector.material, false);
        material.clippingPlanes = planes;
        return <mesh key={connector.key} geometry={connector.geometry} material={material} />;
      })}
    </>
  );
};

const ArchOverlay = () => {
  const scans = useScanStore((s) => s.scans);
  const selectedTooth = useScanStore((s) => s.selectedTooth);

  const items = useMemo(
    () =>
      scans.flatMap((meta) => {
        const arch = getScan(meta.id)?.arch;
        if (!arch) return [];
        return [...arch.slots.values()].map((slot) => ({
          key: `${meta.id}-${slot.tooth}`,
          tooth: slot.tooth,
          position: slot.position.clone().addScaledVector(occlusalAxis(meta.jaw), 1.5),
        }));
      }),
    [scans],
  );

  return (
    <>
      {items.map((item) => (
        <Html
          key={item.key}
          position={item.position}
          center
          distanceFactor={110}
          zIndexRange={[10, 0]}
        >
          <div
            className={`select-none rounded px-1 text-[10px] font-semibold ${
              selectedTooth === item.tooth
                ? 'bg-sky-500 text-white'
                : 'bg-black/55 text-sky-200'
            }`}
          >
            {item.tooth}
          </div>
        </Html>
      ))}
    </>
  );
};

const MeasurementLayer = ({ measurements }: { measurements: Measurement[] }) => (
  <>
    {measurements.map((measurement) => (
      <group key={measurement.id}>
        <Line
          points={measurement.points.map((p) => new THREE.Vector3(...p))}
          color="#38bdf8"
          lineWidth={2}
          depthTest={false}
        />
        {measurement.points.map((point, index) => (
          <mesh key={index} position={point}>
            <sphereGeometry args={[0.45, 12, 12]} />
            <meshBasicMaterial color="#0ea5e9" depthTest={false} />
          </mesh>
        ))}
        <Html
          position={measurement.points[measurement.points.length - 1]}
          center
          distanceFactor={110}
        >
          <div className="whitespace-nowrap rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {measurement.label}
          </div>
        </Html>
      </group>
    ))}
  </>
);

const AutoRotate = () => {
  const autoRotate = useScanStore((s) => s.autoRotate);
  const { camera, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3 } | null;

  useFrame((_, delta) => {
    if (!autoRotate) return;
    const target = controls?.target ?? new THREE.Vector3();
    const offset = camera.position.clone().sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), delta * 0.35);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    invalidate();
  });

  return null;
};

export const visibleRestorations = (
  restorations: Restoration[],
  showBefore: boolean,
  presenting: boolean,
  presentationStage: number,
): Restoration[] => {
  if (showBefore) return [];
  if (!presenting) return restorations;
  return restorations.filter((item) => item.stage <= presentationStage);
};

export const Scene = () => {
  const scans = useScanStore((s) => s.scans);
  const restorations = useScanStore((s) => s.restorations);
  const measurements = useScanStore((s) => s.measurements);
  const selectedId = useScanStore((s) => s.selectedId);
  const mode = useScanStore((s) => s.mode);
  const pendingType = useScanStore((s) => s.pendingType);
  const gizmo = useScanStore((s) => s.gizmo);
  const showArch = useScanStore((s) => s.showArch);
  const showBefore = useScanStore((s) => s.showBefore);
  const presenting = useScanStore((s) => s.presenting);
  const presentationStage = useScanStore((s) => s.presentationStage);

  const select = useScanStore((s) => s.select);
  const selectTooth = useScanStore((s) => s.selectTooth);
  const createRestoration = useScanStore((s) => s.createRestoration);
  const updateRestoration = useScanStore((s) => s.updateRestoration);
  const addMeasurement = useScanStore((s) => s.addMeasurement);
  const setStatus = useScanStore((s) => s.setStatus);

  const planes = useClippingPlanes();
  const objectRefs = useRef(new Map<string, THREE.Object3D>());
  const [refVersion, setRefVersion] = useState(0);
  const [pendingPoints, setPendingPoints] = useState<THREE.Vector3[]>([]);

  const shown = useMemo(
    () => visibleRestorations(restorations, showBefore, presenting, presentationStage),
    [restorations, showBefore, presenting, presentationStage],
  );

  // Stable identity: a fresh callback each render would make React detach and
  // reattach every ref, and the version bump would loop forever.
  const registerRef = useCallback((id: string, object: THREE.Object3D | null) => {
    const map = objectRefs.current;
    if (object) {
      if (map.get(id) === object) return;
      map.set(id, object);
    } else if (!map.delete(id)) {
      return;
    }
    setRefVersion((value) => value + 1);
  }, []);

  const handlePick = (event: ThreeEvent<MouseEvent>, meta: ScanMeta) => {
    if (presenting) return;
    const point = event.point.clone();

    if (mode === 'measure') {
      event.stopPropagation();
      const next = [...pendingPoints, point];
      if (next.length === 2) {
        const distance = next[0].distanceTo(next[1]);
        addMeasurement({
          id: `m-${Date.now().toString(36)}`,
          kind: 'distance',
          points: next.map((p) => [p.x, p.y, p.z] as [number, number, number]),
          label: `${distance.toFixed(2)} мм`,
        });
        setPendingPoints([]);
      } else {
        setPendingPoints(next);
      }
      return;
    }

    if (mode === 'place' && pendingType) {
      event.stopPropagation();
      const tooth = nearestTooth(meta.id, point);
      if (tooth === null) {
        setStatus('Не удалось определить зуб: дуга не распознана на этом скане');
        return;
      }
      const placement = placeOnTooth(
        meta.id,
        meta.jaw,
        tooth,
        pendingType,
        pendingType === 'implant' ? 10 : 8.5,
      );
      if (!placement) {
        setStatus('Не удалось разместить конструкцию на этом участке');
        return;
      }
      selectTooth(tooth);
      createRestoration(tooth, pendingType, placement.transform, placement.height);
      setStatus(null);
      return;
    }

    const tooth = nearestTooth(meta.id, point);
    if (tooth !== null) selectTooth(tooth);
  };

  const commitGizmo = () => {
    if (!selectedId) return;
    const object = objectRefs.current.get(selectedId);
    if (!object) return;
    updateRestoration(selectedId, {
      transform: {
        position: object.position.toArray() as [number, number, number],
        rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
        scale: object.scale.toArray() as [number, number, number],
      },
    });
  };

  const selectedObject = useMemo(
    () => (selectedId && !presenting ? objectRefs.current.get(selectedId) : undefined),
    [selectedId, presenting, refVersion],
  );

  return (
    <>
      <Lighting />
      <ViewportBridge />
      <AutoRotate />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.75}
        panSpeed={0.9}
        zoomSpeed={0.9}
        minDistance={12}
        maxDistance={600}
      />

      {scans.map((meta) => (
        <JawModel key={meta.id} meta={meta} planes={planes} onPick={handlePick} />
      ))}

      {shown.map((item) => (
        <RestorationView
          key={item.id}
          item={item}
          selected={item.id === selectedId}
          planes={planes}
          onSelect={(id) => {
            if (!presenting) select(id);
          }}
          registerRef={registerRef}
        />
      ))}

      <BridgeConnectors restorations={shown} planes={planes} />
      {showArch && !presenting && <ArchOverlay />}
      <MeasurementLayer measurements={measurements} />

      {pendingPoints.map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial color="#f59e0b" depthTest={false} />
        </mesh>
      ))}

      {selectedObject && (
        <TransformControls
          object={selectedObject}
          mode={gizmo}
          size={0.7}
          translationSnap={gizmo === 'translate' ? 0.1 : undefined}
          rotationSnap={gizmo === 'rotate' ? THREE.MathUtils.degToRad(1) : undefined}
          onMouseUp={commitGizmo}
        />
      )}
    </>
  );
};

export const ScanCanvas = () => {
  const setStatus = useScanStore((s) => s.setStatus);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={CAMERA}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        setStatus(null);
      }}
      onPointerMissed={() => useScanStore.getState().select(null)}
    >
      <color attach="background" args={['#0b0f14']} />
      <Scene />
    </Canvas>
  );
};

/** Frames the arches whenever a new scan arrives. */
export const useAutoFrame = (dependency: unknown) => {
  useLayoutEffect(() => {
    const timer = setTimeout(() => viewportApi.current?.setPreset('front'), 60);
    return () => clearTimeout(timer);
  }, [dependency]);
};
