"""Build an opaque, closed, photo-referenced landmark, then export glTF Y-up.

E:/Blender/blender.exe --background --factory-startup --python scripts/build_minghu_stele.py
Authoring: X right, -Y front, Z up. Runtime: X right, +Z front, Y up.
"""
from pathlib import Path
import json
import math
import random

import bpy
import bmesh
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets-source/campus-3d/minghu-stele'
OUTPUT = ROOT / 'public/assets/models/minghu-stele'
REVIEW = ROOT / 'artifacts/minghu-stele'
for folder in [SOURCE, OUTPUT, REVIEW]:
    folder.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(5241)

# Front-only outline traced in a 438×780 review of the source crop, including
# the sloping shoulder and asymmetric chipped crown. The +X side has real depth.
outline = [(180,31),(204,26),(217,29),(244,20),(260,22),(286,52),
           (310,69),(333,112),(348,163),(343,200),(347,234),(354,268),
           (345,303),(354,321),(352,380),(346,442),(343,503),(337,550),
           (340,610),(326,669),(266,677),(223,681),(162,697),(112,715),
           (64,729),(53,686),(56,622),(46,576),(47,514),(39,474),
           (41,427),(38,393),(45,354),(37,331),(35,311),(48,277),
           (59,243),(66,217),(72,183),(80,145),(99,113),(127,87),
           (151,77),(165,56)]
# Crop spans 2.30 × 3.63 units; the front silhouette spans about 1.67 × 3.30.
def point(px, py):
    return ((px / 438 - 0.445) * 2.30, 0.04 + (729 - py) / 709 * 3.30)


def material(name, albedo, normal, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = 0
    image = nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images.load(str(SOURCE / albedo), check_existing=True)
    image.interpolation = 'Linear'
    links.new(image.outputs['Color'], shader.inputs['Base Color'])
    normal_texture = nodes.new('ShaderNodeTexImage')
    normal_texture.image = bpy.data.images.load(str(SOURCE / normal), check_existing=True)
    normal_texture.image.colorspace_settings.name = 'Non-Color'
    bump = nodes.new('ShaderNodeNormalMap')
    bump.inputs['Strength'].default_value = 0.65
    links.new(normal_texture.outputs['Color'], bump.inputs['Color'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    mat.diffuse_color = (0.43, 0.39, 0.33, 1)
    return mat


front_mat = material('Minghu_PhotoInscription', 'front-albedo.jpg', 'front-normal.png', 0.93)
stone_mat = material('Minghu_RoughGranite', 'stone-albedo.jpg', 'stone-normal.png', 0.97)
height_image = bpy.data.images.load(str(SOURCE / 'front-height.png'))
height_pixels = list(height_image.pixels)
hw, hh = height_image.size


def height_at(u, v):
    x, y = int(max(0, min(hw - 1, u * hw))), int(max(0, min(hh - 1, v * hh)))
    return height_pixels[(y * hw + x) * 4] - 0.5


def mesh(name, vertices, faces, materials, material_ids=None, uvs=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    for mat in materials:
        data.materials.append(mat)
    if material_ids:
        for poly, index in zip(data.polygons, material_ids):
            poly.material_index = index
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    layer = data.uv_layers.new(name='UVMap')
    for poly in data.polygons:
        for loop_index in poly.loop_indices:
            index = data.loops[loop_index].vertex_index
            x, y, z = data.vertices[index].co
            uv = uvs[index] if uvs and poly.material_index == 0 else (x * 0.83 + y * 0.55, z * 0.82 + y * 0.37)
            layer.data[loop_index].uv = uv
        poly.use_smooth = True
    # Recalculate the solid's outward normals before the runtime consumes it.
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    data.update()
    return obj


# Sample the traced perimeter at evenly spaced arclengths so the radial rings
# create comparable triangle sizes and no single gigantic cap or paper-thin side.
lengths = [math.dist(a, b) for a, b in zip(outline, outline[1:] + outline[:1])]
total = sum(lengths)
edge = []
for i in range(128):
    cursor = i / 128 * total
    for j, length in enumerate(lengths):
        if cursor <= length:
            a, b = outline[j], outline[(j + 1) % len(outline)]
            edge.append((a[0] + (b[0] - a[0]) * cursor / length,
                         a[1] + (b[1] - a[1]) * cursor / length))
            break
        cursor -= length

vertices, uv, faces, material_ids = [], [], [], []
center = (198, 384)


def add_vertex(px, py, back, t):
    x, z = point(px, py)
    u, v = px / 438, 1 - py / 780
    n = noise.multi_fractal(Vector((x * 4.4, z * 4.4, 1.13)), 1.0, 2.0, 3)
    if back:
        # Estimated unseen back: rounded granite with long natural fracture ridges.
        y = 0.26 + (1 - t * t) * 0.15 + (n - 0.8) * 0.065
        x = x * 0.94 + 0.04 * (1 - t)
    else:
        # The broad polished inscription field is quieter than its rough border.
        field = math.exp(-((px - 218) / 107) ** 6 - ((py - 322) / 185) ** 6)
        y = -0.30 - (n - 0.8) * 0.024 * (1 - field * 0.7) - height_at(u, v) * 0.04
        y += (1 - t) * 0.015
    vertices.append((x, y, z))
    uv.append((u, v))
    return len(vertices) - 1


def cap(back, rings):
    first = add_vertex(*center, back, 0)
    previous = None
    for ring in range(1, rings + 1):
        t = ring / rings
        current = [add_vertex(center[0] + (px - center[0]) * t,
                              center[1] + (py - center[1]) * t, back, t)
                   for px, py in edge]
        for i in range(128):
            j = (i + 1) % 128
            if previous is None:
                faces.append((first, current[i], current[j]))
                material_ids.append(1 if back else 0)
            else:
                faces.extend([(previous[i], current[i], current[j]),
                              (previous[i], current[j], previous[j])])
                material_ids.extend([1 if back else 0] * 2)
        previous = current
    return previous


front_edge = cap(False, 22)
back_edge = cap(True, 12)
previous = front_edge
for ring in range(1, 7):
    t = ring / 7
    current = []
    for i in range(128):
        front, back = Vector(vertices[front_edge[i]]), Vector(vertices[back_edge[i]])
        p = front.lerp(back, t)
        # Side bulges and chips break the extruded-card outline.
        bulge = math.sin(t * math.pi) * (0.045 + 0.025 * math.sin(i * 1.7))
        p.x += (1 if p.x > 0 else -1) * bulge
        p.z += bulge * math.sin(i * 0.8)
        vertices.append(tuple(p))
        uv.append((0, 0))
        current.append(len(vertices) - 1)
    for i in range(128):
        j = (i + 1) % 128
        faces.extend([(previous[i], current[i], current[j]), (previous[i], current[j], previous[j])])
        material_ids.extend([1, 1])
    previous = current
for i in range(128):
    j = (i + 1) % 128
    faces.extend([(previous[i], back_edge[i], back_edge[j]), (previous[i], back_edge[j], previous[j])])
    material_ids.extend([1, 1])
body = mesh('Minghu_SolidStele', vertices, faces, [front_mat, stone_mat], material_ids, uv)


def foot_rock(name, location, scale, seed):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    for vertex in obj.data.vertices:
        variation = noise.noise_vector(vertex.co * 3.5 + Vector((seed, 0, 0))) * 0.13
        vertex.co += variation
        vertex.co.x *= scale[0]
        vertex.co.y *= scale[1]
        vertex.co.z *= scale[2]
    # The pool-side foot is flat enough to plant at the ground origin.
    for vertex in obj.data.vertices:
        vertex.co.z = max(vertex.co.z, -location[2])
    obj.data.materials.append(stone_mat)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    for poly in obj.data.polygons:
        for li in poly.loop_indices:
            p = obj.data.vertices[obj.data.loops[li].vertex_index].co
            obj.data.uv_layers.active.data[li].uv = (p.x * 1.3 + p.y * 0.6, p.z * 1.5 + p.y * 0.6)
    return obj


foot_rock('Minghu_FootRock_Left', (-0.70, -0.18, 0.19), (0.48, 0.48, 0.28), 3)
foot_rock('Minghu_FootRock_Front', (0.03, -0.49, 0.14), (0.66, 0.35, 0.20), 5)
foot_rock('Minghu_FootRock_Right', (0.78, -0.14, 0.16), (0.40, 0.40, 0.25), 8)
foot_rock('Minghu_FootRock_Back', (0.08, 0.06, 0.10), (0.75, 0.47, 0.19), 11)

model_objects = list(bpy.context.scene.objects)
for obj in model_objects:
    obj['reference'] = 'User-supplied Minghu stone photograph, 2026-11-25'
    obj['fixed_orientation'] = True
    obj['front_axis'] = '-Y in Blender, +Z in glTF'
for image in bpy.data.images:
    if image.source == 'FILE':
        image.pack()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'minghu-stele.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in model_objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'minghu-stele.glb'), export_format='GLB',
                          use_selection=True, export_yup=True, export_apply=True,
                          export_image_format='AUTO', export_materials='EXPORT', export_tangents=True,
                          export_extras=True, export_cameras=False, export_lights=False)
triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in model_objects)
report = dict(name='Minghu Stele', objects=len(model_objects), triangles=triangles,
              materials=2, front='+Z', height=3.34, pivot='ground-centred',
              source='reference.png; user supplied 2026-11-25',
              reconstruction='Front silhouette/inscription photo referenced; unseen sides estimated',
              bytes=(OUTPUT / 'minghu-stele.glb').stat().st_size)
(OUTPUT / 'asset-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('MINGHU_MODEL_REPORT ' + json.dumps(report))
