import "./styles.css";

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  Clock,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  SpotLight,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.querySelector<HTMLCanvasElement>("#scene");

if (!canvas) {
  throw new Error("Scene canvas not found.");
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

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

const engineRoot = new Group();
scene.add(engineRoot);

const ambientLight = new AmbientLight(0xffffff, 1.35);
scene.add(ambientLight);

const keyLight = new DirectionalLight(0xffffff, 1.75);
keyLight.position.set(2.5, 2.2, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const mouseLight = new SpotLight(0xffffff, 4.5, 9, 0.16, 0.72, 1.4);
mouseLight.position.set(0, 0, 3.4);
mouseLight.target.position.set(0, 0, 0);
mouseLight.castShadow = false;
scene.add(mouseLight);
scene.add(mouseLight.target);

const horizontalTurnAmount = 0.5;
const pointer = new Vector2(1, 0);
const smoothedPointer = new Vector2(1, 0);
const targetRotation = new Vector2(0, horizontalTurnAmount);
const pointerWorldPosition = new Vector3();
const pointerRayDirection = new Vector3();
const clock = new Clock();
const loader = new GLTFLoader();
const minimalRotationSpeed = 0.35;
const maximumRotationSpeed = 5;

let propeller: Object3D | null = null;
let spinAxis: "x" | "y" | "z" = "z";
let propellerSpin = 0;
let propellerBaseRotation = 0;

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

function findPropeller(root: Object3D): Object3D | null {
  let match: Object3D | null = null;

  root.traverse((object) => {
    if (match) {
      return;
    }

    if (object.name.toLowerCase().includes("propellery")) {
      match = object;
    }
  });

  return match;
}

function inferSpinAxis(object: Object3D): "x" | "y" | "z" {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const values: Array<["x" | "y" | "z", number]> = [
    ["x", size.x],
    ["y", size.y],
    ["z", size.z],
  ];

  values.sort((a, b) => a[1] - b[1]);

  return values[0][0];
}

function normalizeModel(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z);
  const scale = 27 / largestDimension;

  model.position.sub(center);
  model.scale.setScalar(scale);

  const normalizedBox = new Box3().setFromObject(model);
  const normalizedCenter = normalizedBox.getCenter(new Vector3());
  model.position.sub(normalizedCenter);

  const frontAlignedBox = new Box3().setFromObject(model);
  model.position.z -= frontAlignedBox.max.z;
}

function tuneMaterials(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    object.castShadow = true;
    object.receiveShadow = true;

    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      if (material instanceof MeshStandardMaterial) {
        material.metalness = Math.max(material.metalness, 0.65);
        material.roughness = Math.min(Math.max(material.roughness, 0.08), 0.18);
        material.envMapIntensity = 2.2;
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

  targetRotation.x = -smoothedPointer.y * 0.14;
  targetRotation.y = ((smoothedPointer.x + 1) / 2) * horizontalTurnAmount;

  engineRoot.position.x = -viewportWidth * 0.25;
  engineRoot.rotation.x = MathUtils.damp(engineRoot.rotation.x, targetRotation.x, 5, delta);
  engineRoot.rotation.y = MathUtils.damp(engineRoot.rotation.y, targetRotation.y, 5, delta);

  getPointerPositionAtDepth(2.9, pointerWorldPosition);
  mouseLight.position.copy(pointerWorldPosition);
  mouseLight.position.z = 3.4;

  getPointerPositionAtDepth(0, pointerWorldPosition);
  mouseLight.target.position.copy(pointerWorldPosition);

  if (propeller) {
    propellerSpin = (propellerSpin + delta * propellerSpeed) % (Math.PI * 2);
    propeller.rotation[spinAxis] = propellerBaseRotation - propellerSpin;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener("resize", resizeRenderer);
window.addEventListener("pointermove", updatePointer, { passive: true });

resizeRenderer();

loader.load(
  `${import.meta.env.BASE_URL}assets/jet_engine.glb`,
  (gltf) => {
    const model = gltf.scene;

    //model.rotation.y = Math.PI;
    normalizeModel(model);
    tuneMaterials(model);

    propeller = findPropeller(model);
    if (propeller) {
      spinAxis = inferSpinAxis(propeller);
      propellerBaseRotation = propeller.rotation[spinAxis];
      disablePropellerShadows(propeller);
    }

    engineRoot.add(model);
  },
  undefined,
  (error) => {
    console.error("Unable to load jet engine model.", error);
  },
);

animate();
