import "./styles.css";

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  SRGBColorSpace,
  SpotLight,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const centerEngineControl = document.querySelector<HTMLInputElement>("#center-engine");
const lockEngineFacingControl = document.querySelector<HTMLInputElement>("#lock-engine-facing");

if (!canvas) {
  throw new Error("Scene canvas not found.");
}

if (!centerEngineControl || !lockEngineFacingControl) {
  throw new Error("Engine controls not found.");
}

const scene = new Scene();
scene.background = new Color(0x101010);

const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.06;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const pmremGenerator = new PMREMGenerator(renderer);

function createEnvironmentMap(): CanvasTexture {
  const environmentCanvas = document.createElement("canvas");
  environmentCanvas.width = 1024;
  environmentCanvas.height = 512;

  const context = environmentCanvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create environment map.");
  }

  const gradient = context.createLinearGradient(0, 0, 0, environmentCanvas.height);
  gradient.addColorStop(0, "#f0f0f0");
  gradient.addColorStop(0.28, "#3f3f3f");
  gradient.addColorStop(0.5, "#090909");
  gradient.addColorStop(0.72, "#343434");
  gradient.addColorStop(1, "#dadada");
  context.fillStyle = gradient;
  context.fillRect(0, 0, environmentCanvas.width, environmentCanvas.height);

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillRect(110, 84, 54, 344);
  context.fillRect(812, 54, 86, 404);

  context.fillStyle = "rgba(210, 210, 210, 0.56)";
  context.fillRect(348, 30, 180, 62);
  context.fillRect(448, 410, 270, 46);

  const texture = new CanvasTexture(environmentCanvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;

  return texture;
}

const environmentMap = createEnvironmentMap();
scene.environment = pmremGenerator.fromEquirectangular(environmentMap).texture;
environmentMap.dispose();

const camera = new PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 0, 6.2);
camera.layers.enable(0);

const engineRoot = new Group();
scene.add(engineRoot);

const ambientLight = new AmbientLight(0xffffff, 2.35);
scene.add(ambientLight);

/*const keyLight = new DirectionalLight(0xffffff, 3.2);
keyLight.position.set(2.5, 2.2, 4);
keyLight.castShadow = false;
scene.add(keyLight);*/

const mouseLight = new SpotLight(0xffffff, 14, 14, 0.34, 0.7, 0.9);
mouseLight.position.set(0, 0, 5.6);
mouseLight.target.position.set(0, 0, 0);
mouseLight.castShadow = false;
scene.add(mouseLight);
scene.add(mouseLight.target);

const cursorPointLight = new PointLight(0xffffff, 24, 8, 1.25);
cursorPointLight.position.set(0, 0, 5.7);
scene.add(cursorPointLight);

/*const cameraPointLight = new PointLight(0xffffff, 22, 12, 2);
cameraPointLight.position.copy(camera.position);
scene.add(cameraPointLight);*/

const horizontalTurnAmount = 0.5;
const pointer = new Vector2(1, 0);
const smoothedPointer = new Vector2(1, 0);
const targetRotation = new Vector2(0, horizontalTurnAmount);
const pointerWorldPosition = new Vector3();
const mouseTargetPosition = new Vector3();
const pointerRayDirection = new Vector3();
const clock = new Clock();
const loader = new GLTFLoader();
const minimalRotationSpeed = 0.35;
const maximumRotationSpeed = 5;

type Axis = "x" | "y" | "z";

type SpinnerConfig = {
  name?: string;
  nameIncludes?: string;
  axis?: Axis;
  direction: 1 | -1;
  speedMultiplier?: number;
};

type ModelConfig = {
  fileName: string;
  scale: number;
  materialTuning: "original-metal" | "preserve";
  rotation?: Partial<Record<Axis, number>>;
  spinners: SpinnerConfig[];
};

type Spinner = {
  object: Object3D;
  axis: Axis;
  baseRotation: number;
  direction: 1 | -1;
  speedMultiplier: number;
};

const modelConfigs = {
  original: {
    fileName: "jet_engine.glb",
    scale: 32.4,
    materialTuning: "original-metal",
    spinners: [
      {
        nameIncludes: "propellery",
        direction: -1,
      },
    ],
  },
  turbine2: {
    fileName: "jet_engine2.glb",
    scale: 32.4,
    materialTuning: "original-metal",
    rotation: {
      y: -Math.PI / 2,
    },
    spinners: [
      {
        name: "Object_15",
        axis: "x",
        direction: -1,
      },
      {
        name: "Object_5",
        axis: "x",
        direction: -1,
      },
      {
        name: "Object_8",
        axis: "x",
        direction: 1,
      },
    ],
  },
} satisfies Record<string, ModelConfig>;

const activeModelConfig = modelConfigs.turbine2;

const spinners: Spinner[] = [];
let propellerSpin = 0;
let shouldCenterEngine = centerEngineControl.checked;
let shouldLockEngineFacing = lockEngineFacingControl.checked;

function getScrollProgress(): number {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

  if (maxScroll <= 0) {
    return 0;
  }

  return MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
}

function resizeRenderer(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function findObject(root: Object3D, config: SpinnerConfig): Object3D | null {
  let match: Object3D | null = null;

  root.traverse((object) => {
    if (match) {
      return;
    }

    if (config.name && object.name === config.name) {
      match = object;
      return;
    }

    if (config.nameIncludes && object.name.toLowerCase().includes(config.nameIncludes)) {
      match = object;
    }
  });

  return match;
}

function inferSpinAxis(object: Object3D): Axis {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const values: Array<[Axis, number]> = [
    ["x", size.x],
    ["y", size.y],
    ["z", size.z],
  ];

  values.sort((a, b) => a[1] - b[1]);

  return values[0][0];
}

function normalizeModel(model: Object3D, config: ModelConfig): void {
  model.rotation.set(
    config.rotation?.x ?? 0,
    config.rotation?.y ?? 0,
    config.rotation?.z ?? 0,
  );
  model.updateMatrixWorld(true);

  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z);
  const scale = config.scale / largestDimension;

  model.position.sub(center);
  model.scale.setScalar(scale);

  const normalizedBox = new Box3().setFromObject(model);
  const normalizedCenter = normalizedBox.getCenter(new Vector3());
  model.position.sub(normalizedCenter);

  const frontAlignedBox = new Box3().setFromObject(model);
  model.position.z -= frontAlignedBox.max.z;
}

function tuneMaterials(root: Object3D, mode: ModelConfig["materialTuning"]): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      if (material instanceof MeshStandardMaterial) {
        if (mode === "original-metal") {
          material.color.set(0xffffff);
          material.side = DoubleSide;
          material.metalness = 0.72;
          material.roughness = 0.2;
          material.envMapIntensity = 14.5;
        } else {
          material.side = DoubleSide;
          material.envMapIntensity = 14;/*Math.max(
            material.envMapIntensity,
            material.metalness > 0.5 ? 2.4 : 1.6,
          );*/
        }
      }
    }
  });
}

function disablePropellerShadows(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
}

function setupSpinners(root: Object3D, configs: SpinnerConfig[]): void {
  spinners.length = 0;

  for (const config of configs) {
    const object = findObject(root, config);

    if (!object) {
      console.warn("Unable to find spinner object.", config);
      continue;
    }

    const axis = config.axis ?? inferSpinAxis(object);

    spinners.push({
      object,
      axis,
      baseRotation: object.rotation[axis],
      direction: config.direction,
      speedMultiplier: config.speedMultiplier ?? 1,
    });

    disablePropellerShadows(object);
  }
}

function updatePointer(event: PointerEvent): void {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function getPointerPositionAtDepth(z: number, target: Vector3): Vector3 {
  target.set(pointer.x, pointer.y, 0.5).unproject(camera);
  pointerRayDirection.copy(target).sub(camera.position).normalize();

  const distance = (z - camera.position.z) / pointerRayDirection.z;
  return target.copy(camera.position).addScaledVector(pointerRayDirection, distance);
}

function animate(): void {
  const delta = clock.getDelta();
  const scrollProgress = getScrollProgress();
  const propellerSpeed =
    minimalRotationSpeed + (maximumRotationSpeed - minimalRotationSpeed) * scrollProgress;
  const viewportHeight = 2 * Math.tan(MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
  const viewportWidth = viewportHeight * camera.aspect;

  smoothedPointer.lerp(pointer, 1 - Math.exp(-delta * 4));

  if (shouldLockEngineFacing) {
    targetRotation.set(0, 0);
  } else {
    targetRotation.x = -smoothedPointer.y * 0.14;
    targetRotation.y = ((smoothedPointer.x + 1) / 2) * horizontalTurnAmount;
  }

  const targetEngineX = shouldCenterEngine ? 0 : -viewportWidth * 0.25;
  engineRoot.position.x = MathUtils.damp(engineRoot.position.x, targetEngineX, 6, delta);
  engineRoot.rotation.x = MathUtils.damp(engineRoot.rotation.x, targetRotation.x, 5, delta);
  engineRoot.rotation.y = MathUtils.damp(engineRoot.rotation.y, targetRotation.y, 5, delta);

  getPointerPositionAtDepth(5.6, pointerWorldPosition);
  mouseLight.position.copy(pointerWorldPosition);
  mouseLight.position.z = 5.6;
  cursorPointLight.position.copy(mouseLight.position);
  cursorPointLight.position.z = 5.7;

  mouseTargetPosition.set(mouseLight.position.x, mouseLight.position.y, 0);
  mouseLight.target.position.copy(mouseTargetPosition);

  if (spinners.length > 0) {
    propellerSpin = (propellerSpin + delta * propellerSpeed) % (Math.PI * 2);

    for (const spinner of spinners) {
      spinner.object.rotation[spinner.axis] =
        spinner.baseRotation + propellerSpin * spinner.direction * spinner.speedMultiplier;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeRenderer);
window.addEventListener("pointermove", updatePointer, { passive: true });
centerEngineControl.addEventListener("change", () => {
  shouldCenterEngine = centerEngineControl.checked;
});
lockEngineFacingControl.addEventListener("change", () => {
  shouldLockEngineFacing = lockEngineFacingControl.checked;
});

resizeRenderer();

loader.load(
  `${import.meta.env.BASE_URL}assets/${activeModelConfig.fileName}`,
  (gltf) => {
    const model = gltf.scene;

    normalizeModel(model, activeModelConfig);
    tuneMaterials(model, activeModelConfig.materialTuning);
    setupSpinners(model, activeModelConfig.spinners);

    engineRoot.add(model);
  },
  undefined,
  (error) => {
    console.error("Unable to load jet engine model.", error);
  },
);

animate();
