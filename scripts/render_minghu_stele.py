"""Render the shipped GLB from three angles, including the reconstructed back."""
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/minghu-stele'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/assets/models/minghu-stele/minghu-stele.glb'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 780
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.world.color = (0.28, 0.31, 0.35)
scene.view_settings.view_transform = 'AgX'
bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.name = 'ReviewOnly_Floor'
mat = bpy.data.materials.new('ReviewOnly_Slate')
mat.diffuse_color = (0.105, 0.125, 0.135, 1)
floor.data.materials.append(mat)
for location, energy, size in [((-3, -5, 7), 750, 4), ((4, -2, 5), 350, 4), ((1, 4, 6), 700, 3)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    lamp = bpy.context.object
    lamp.data.energy = energy
    lamp.data.shape = 'DISK'
    lamp.data.size = size
    lamp.rotation_euler = (Vector((0, 0, 1.5)) - lamp.location).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 4.25
scene.camera = camera
for name, location in [('front', (0, -8, 2.7)), ('three-quarter', (4.0, -7, 3.2)), ('back', (4, 7, 3.0))]:
    camera.location = location
    camera.rotation_euler = (Vector((0, 0, 1.7)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
