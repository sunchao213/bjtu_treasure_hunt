import * as THREE from 'three';

interface TreeLocation {
  x: number;
  z: number;
  variant: number;
}

/** One cutout draw for all trees, rooted in the world while facing the camera. */
export class CampusTreeView {
  readonly mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly visibility: THREE.InstancedBufferAttribute;
  private readonly transform = new THREE.Matrix4();
  private readonly inverseFacing = new THREE.Quaternion();
  private readonly facing = new THREE.Quaternion(0, 0, 0, 0);
  private readonly scale = new THREE.Vector3();
  private readonly relative = new THREE.Vector3();
  private readonly root = new THREE.Vector3();
  private readonly sizes: number[];

  constructor(
    scene: THREE.Scene,
    texture: THREE.Texture,
    private readonly trees: readonly TreeLocation[],
  ) {
    const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 504 / 512 - 0.5, 0);
    this.visibility = new THREE.InstancedBufferAttribute(
      new Float32Array(trees.length).fill(1),
      1,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('canopyVisibility', this.visibility);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xc4ccbe,
      alphaTest: 0.5,
      roughness: 1,
      metalness: 0,
    });
    material.name = 'Campus_PixelTree';
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float canopyVisibility;\nvarying float vCanopyVisibility;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvCanopyVisibility = canopyVisibility;',
        )
        .replace(
          '#include <defaultnormal_vertex>',
          '#include <defaultnormal_vertex>\ntransformedNormal = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vCanopyVisibility;')
        .replace(
          '#include <alphatest_fragment>',
          // Screen-door fading keeps depth-writing cutouts correctly ordered.
          '#include <alphatest_fragment>\nif (fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029))) > vCanopyVisibility) discard;',
        );
    };
    material.customProgramCacheKey = () => 'campus-pixel-tree-v1';
    this.mesh = new THREE.InstancedMesh(geometry, material, trees.length);
    this.mesh.name = 'Campus_PixelTrees';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The camera changes every card's bounds; the small shared batch stays cheap.
    this.mesh.frustumCulled = false;
    this.sizes = trees.map((_, i) => 3.05 * (0.94 + ((i * 37) % 17) / 140));
    for (let i = 0; i < trees.length; i++) {
      this.mesh.setColorAt(i, new THREE.Color().setScalar(0.93 + ((i * 7) % 9) / 120));
    }
    scene.add(this.mesh);
  }

  update(
    camera: THREE.Camera,
    player: THREE.Vector3,
    deltaMs: number,
    landmarks: readonly THREE.Vector3[] = [],
  ): void {
    const rotated = 1 - Math.abs(this.facing.dot(camera.quaternion)) > 0.000001;
    this.inverseFacing.copy(camera.quaternion).invert();
    const step = 1 - Math.exp(-Math.min(deltaMs, 100) / 100);
    let faded = false;
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i]!;
      const size = this.sizes[i]!;
      this.root.set(tree.x, 0.045, tree.z);
      if (rotated) {
        this.scale.setScalar(size);
        this.transform.compose(this.root, camera.quaternion, this.scale);
        this.mesh.setMatrixAt(i, this.transform);
      }
      // In camera space, a negative Z puts the player behind this tree's card.
      this.relative.copy(player).sub(this.root).applyQuaternion(this.inverseFacing);
      const blocked =
        this.relative.z < -0.15 &&
        this.relative.z > -size * 4 &&
        Math.abs(this.relative.x) < size * 0.43 &&
        this.relative.y > size * 0.08 &&
        this.relative.y < size * 0.96;
      const hidesLandmark = landmarks.some((point) => {
        this.relative.copy(point).sub(this.root).applyQuaternion(this.inverseFacing);
        return (
          this.relative.z < -0.15 &&
          this.relative.z > -size * 4 &&
          Math.abs(this.relative.x) < size * 0.43 &&
          this.relative.y > size * 0.08 &&
          this.relative.y < size * 0.96
        );
      });
      const current = this.visibility.getX(i);
      const next = THREE.MathUtils.lerp(current, hidesLandmark ? 0.1 : blocked ? 0.25 : 1, step);
      if (Math.abs(next - current) > 0.0001) {
        this.visibility.setX(i, next);
        faded = true;
      }
    }
    if (rotated) {
      this.facing.copy(camera.quaternion);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    if (faded) this.visibility.needsUpdate = true;
  }
}
