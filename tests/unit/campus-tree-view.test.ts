import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Quaternion, Scene, Texture, Vector3 } from 'three';
import { CampusTreeView } from '../../src/campus-3d/tree-view';

function setup() {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 1, 0);
  const trees = new CampusTreeView(new Scene(), new Texture(), [
    { x: 0, z: 0, variant: 0 },
    { x: 8, z: 0, variant: 2 },
  ]);
  return { camera, trees };
}

describe('pixel campus trees', () => {
  it('keeps each root fixed and each tree facing the camera through a full orbit', () => {
    const { camera, trees } = setup();
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      camera.position.set(Math.sin(yaw) * 10, 5, Math.cos(yaw) * 10);
      camera.lookAt(0, 1, 0);
      trees.update(camera, new Vector3(30, 0.8, 30), 16);
      for (const i of [0, 1]) {
        const matrix = new Matrix4();
        trees.mesh.getMatrixAt(i, matrix);
        const position = new Vector3();
        const rotation = new Quaternion();
        matrix.decompose(position, rotation, new Vector3());
        expect(position.x).toBeCloseTo(i * 8);
        expect(position.y).toBeCloseTo(0.045);
        expect(position.z).toBeCloseTo(0);
        expect(Math.abs(rotation.dot(camera.quaternion))).toBeCloseTo(1);
      }
    }
  });

  it('fades the blocking canopy, then restores it when the player steps in front', () => {
    const { camera, trees } = setup();
    const visibility = trees.mesh.geometry.getAttribute('canopyVisibility');
    for (let i = 0; i < 10; i++) trees.update(camera, new Vector3(0, 0.8, -1.5), 100);
    expect(visibility.getX(0)).toBeCloseTo(0.25, 3);
    expect(visibility.getX(1)).toBe(1);
    for (let i = 0; i < 10; i++) trees.update(camera, new Vector3(0, 0.8, 3), 100);
    expect(visibility.getX(0)).toBeCloseTo(1, 3);
  });

  it('keeps story landmarks readable behind a canopy independently of the player', () => {
    const { camera, trees } = setup();
    const visibility = trees.mesh.geometry.getAttribute('canopyVisibility');
    for (let i = 0; i < 10; i++)
      trees.update(camera, new Vector3(20, 0.8, 20), 100, [new Vector3(0, 1.1, -1.5)]);
    expect(visibility.getX(0)).toBeCloseTo(0.1, 3);
    expect(visibility.getX(1)).toBe(1);
    for (let i = 0; i < 10; i++) trees.update(camera, new Vector3(20, 0.8, 20), 100, []);
    expect(visibility.getX(0)).toBeCloseTo(1, 3);
  });
});
