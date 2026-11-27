"""Rebuild an authorised image reference in Blender; no source website mesh exists.

Run: blender --background --factory-startup --python scripts/build_south_gate_sample.py
Blender Z-up authoring -> glTF Y-up; Blender -Y is the game's positive map Y.
"""

import bpy
import json
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-source/campus-3d"
OUTPUT = ROOT / "public/assets/models/bjtu-south-gate"
OUTPUT.mkdir(parents=True, exist_ok=True)
LAYOUT = json.loads((SOURCE / "south-gate-layout.json").read_text(encoding="utf-8"))
U = LAYOUT["unitsPerMetre"]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
random.seed(93)
bpy.context.preferences.filepaths.save_version = 0


def material(name, color, roughness=0.85, metallic=0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    bsdf = result.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return result


stone = material("gate_red_granite", (0.30, 0.075, 0.055), 0.66)
trim = material("granite_recess", (0.16, 0.035, 0.028))
gold = material("school_name_brass", (0.82, 0.55, 0.16), 0.46, 0.35)
wall = material("academic_warm_stucco", (0.68, 0.59, 0.44))
roof = material("limestone_roof", (0.52, 0.55, 0.51))
sill = material("light_stone_trim", (0.84, 0.80, 0.68))
glass = material("blue_grey_window", (0.10, 0.24, 0.29), 0.36, 0.12)
metal = material("gate_metal", (0.35, 0.40, 0.35), 0.65, 0.2)
paving = material("brick_paving", (0.50, 0.29, 0.22))
joint = material("paving_joints", (0.67, 0.48, 0.37))
bench = material("timber", (0.29, 0.19, 0.11))
green = material("hedge", (0.18, 0.29, 0.11))


def tile_texture(mat, name, base, size, brick=False):
    """Small deterministic packed PNGs; no photo shadows are baked into materials."""
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    pixels = []
    for y in range(size):
        for x in range(size):
            noise = random.uniform(-0.025, 0.025)
            seam = brick and (y % 32 < 2 or (x + (16 if (y // 32) % 2 else 0)) % 64 < 2)
            tone = -0.085 if seam else noise
            pixels.extend([max(0, min(1, c + tone)) for c in base] + [1])
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(SOURCE / (name + ".png"))
    image.file_format = "PNG"
    image.save()
    image.pack()
    nodes = mat.node_tree.nodes
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    return image


tile_texture(stone, "gate-granite", (0.32, 0.085, 0.065), 256)
tile_texture(wall, "academic-stucco", (0.70, 0.62, 0.48), 256, True)
tile_texture(paving, "courtyard-brick", (0.51, 0.30, 0.23), 256, True)


def box(name, x, map_y, z, width, depth, height, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -map_y, z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def strip(name, outer, inner, depth, mat, cx, cy):
    """Extruded arch band, retaining the actual opening rather than a solid box."""
    count = len(outer)
    verts = []
    for side in [-depth / 2, depth / 2]:
        verts += [(cx + x, -cy + side, z) for x, z in outer]
        verts += [(cx + x, -cy + side, z) for x, z in inner]
    faces = []
    for i in range(count - 1):
        j = i + 1
        faces += [
            (i, j, count + j, count + i),
            (2 * count + i, 3 * count + i, 3 * count + j, 2 * count + j),
            (i, 2 * count + i, 2 * count + j, j),
            (count + i, count + j, 3 * count + j, 3 * count + i),
        ]
    faces += [(0, count, 3 * count, 2 * count),
              (count - 1, 3 * count - 1, 4 * count - 1, 2 * count - 1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    # Planar mapping is adequate for homogeneous stone, explicit UVs survive GLB export.
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop in poly.loop_indices:
            v = mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv = (v.x / 2, v.z / 2)
    return obj


FONT = Path("C:/Windows/Fonts/simhei.ttf")
if not FONT.exists():
    FONT = Path("C:/Windows/Fonts/msyh.ttc")
font = bpy.data.fonts.load(str(FONT))


def text(name, label, x, map_y, z, size, mat, angle=0):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = label
    curve.font = font
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.extrude = 0.004
    curve.resolution_u = 3
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (x, -map_y, z)
    # Face Blender -Y, i.e. south / Three.js +Z, with optional tangent rotation.
    obj.rotation_euler = (math.pi / 2, angle, 0)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)


gate = LAYOUT["gate"]
gx, gy = gate["x"] / U, gate["y"] / U
span, width, depth = gate["width"] / U, gate["pillarWidth"] / U, gate["depth"] / U
spring = gate["springHeight"]
outer_r, inner_r = span / 2 + width / 2, span / 2 - width / 2
outer = [(-outer_r, 0.1)]
inner = [(-inner_r, 0.1)]
for i in range(33):
    angle = math.pi - i * math.pi / 32
    outer.append((outer_r * math.cos(angle), spring + outer_r * math.sin(angle)))
    inner.append((inner_r * math.cos(angle), spring + inner_r * math.sin(angle)))
outer.append((outer_r, 0.1))
inner.append((inner_r, 0.1))
strip("SouthGate_RedArch", outer, inner, depth, stone, gx, gy)
# Recessed silver inner edge, slim enough to keep the passage clear.
strip("SouthGate_InnerTrim", inner,
      [(x * 0.98, z + 0.035) for x, z in inner], depth * 0.86, sill, gx, gy)
for side in [-1, 1]:
    px = gx + side * span / 2
    box("SouthGate_Foot", px, gy, 0.13, width, depth, 0.26, trim)
    # Shallow masonry courses emphasise the red-granite structure.
    for z in [0.8, 1.6, 2.4, 3.1]:
        box("SouthGate_StoneCourse", px, gy + depth / 2 + 0.002, z,
            width * 0.93, 0.015, 0.025, trim)
    # The school name is visible from either side of the portal in game.
for index, character in enumerate("北京交通大学"):
    a = math.radians(151 - index * 24.4)
    r = (outer_r + inner_r) / 2
    text("SouthGate_Name", character, gx + r * math.cos(a), gy + depth / 2 + 0.012,
         spring + r * math.sin(a), 0.48, gold, math.pi / 2 - a)

# A small crown medallion, with a plain emblem rather than an invented exact school seal.
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.22, depth=0.035,
                                  location=(gx, -gy - depth / 2 - 0.035, spring + outer_r - 0.13),
                                  rotation=(math.pi / 2, 0, 0))
bpy.context.object.name = "SouthGate_CrownMedallion"
bpy.context.object.data.materials.append(gold)

g = LAYOUT["guardhouse"]
hx, hy = (g["x"] + g["width"] / 2) / U, (g["y"] + g["height"] / 2) / U
hw, hd = g["width"] / U, g["height"] / U
box("Guardhouse_Walls", hx, hy, 0.6, hw, hd, 1.2, wall)
box("Guardhouse_Roof", hx, hy, 1.28, hw + 0.2, hd + 0.2, 0.17, roof)
box("Guardhouse_FrontGlazing", hx, hy + hd / 2 + 0.015, 0.82, hw * 0.7, 0.035, 0.48, glass)
box("Guardhouse_SideGlazing", hx - hw / 2 - 0.015, hy, 0.82, 0.035, hd * 0.65, 0.48, glass)
text("Guardhouse_Sign", "校 园 门 卫", hx, hy + hd / 2 + 0.04, 1.12, 0.20, gold)
# Rails remain outside the main gate opening and outside the active extraction lane.
for px in [11.6, 22.8]:
    box("Gate_RailingTop", px, gy + 0.05, 0.8, 0.8, 0.08, 0.08, metal)
    for offset in [-0.32, -0.1, 0.1, 0.32]:
        box("Gate_RailingBar", px + offset, gy + 0.05, 0.42, 0.045, 0.045, 0.8, metal)

# A compact academic courtyard block: reference-derived massing, not georeferenced survey geometry.
b = LAYOUT["building"]
bx, by = (b["x"] + b["width"] / 2) / U, (b["y"] + b["height"] / 2) / U
bw, bd = b["width"] / U, b["height"] / U
height = 4.35
box("Academic_MainWing", bx, by - 1.45, height / 2, bw, 2.1, height, wall)
for side in [-1, 1]:
    box("Academic_SideWing", bx + side * (bw / 2 - 0.85), by + 0.8, height / 2,
        1.7, bd - 2.1, height, wall)
    box("Academic_SideRoof", bx + side * (bw / 2 - 0.85), by + 0.8, height + 0.07,
        1.82, bd - 1.98, 0.14, roof)
box("Academic_MainRoof", bx, by - 1.45, height + 0.07, bw + 0.12, 2.22, 0.14, roof)
box("Academic_CourtyardPlinth", bx, by, 0.08, bw, bd, 0.16, sill)
for floor in range(4):
    z = 0.65 + floor * 0.95
    for column in range(10):
        wx = bx - 3.6 + column * 0.8
        for facade in [-1, 1]:
            wy = by - 1.45 + facade * 1.06
            box("Academic_Window", wx, wy, z, 0.48, 0.025, 0.57, glass)
            box("Academic_WindowSill", wx, wy, z - 0.32, 0.56, 0.08, 0.055, sill)
    for side in [-1, 1]:
        for row in range(3):
            wy = by - 0.2 + row * 0.9
            box("Academic_SideWindow", bx + side * (bw / 2 + 0.013), wy, z,
                0.025, 0.5, 0.57, glass)
        for column in range(2):
            wx = bx + side * (bw / 2 - 0.85) - 0.4 + column * 0.8
            box("Academic_EndWindow", wx, by + bd / 2 + 0.013, z, 0.48, 0.025, 0.57, glass)
box("Academic_CentralEntry", bx, by - 0.36, 0.76, 1.0, 0.045, 1.4, glass)
box("Academic_EntryCanopy", bx, by - 0.12, 1.6, 1.6, 0.65, 0.12, roof)
text("Academic_Label", "教 学 楼", bx, by - 0.36 + 0.06, 3.88, 0.33, gold)

p = LAYOUT["paving"]
px, py = (p["x"] + p["width"] / 2) / U, (p["y"] + p["height"] / 2) / U
box("Gate_Plaza", px, py, 0.004, p["width"] / U, p["height"] / U, 0.014, paving)
# Edge stones and joints stay below the ground-plane feet position.
for side in [-1, 1]:
    box("Gate_PlazaCurb", px + side * (p["width"] / U / 2), py, 0.016,
        0.10, p["height"] / U, 0.026, sill)
for i in range(9):
    box("Gate_PlazaJoint", px, py - p["height"] / U / 2 + i * 0.42, 0.013,
        p["width"] / U, 0.015, 0.003, joint)

# Keep authored sources editable, but batch runtime geometry by material and zone.
for obj in list(bpy.context.scene.objects):
    if obj.type == "MESH":
        obj["asset_source"] = "reference-reconstruction:map.bjtu.edu.cn"
        obj["collision"] = "external:south-gate-layout.json"
bpy.ops.object.select_all(action="DESELECT")
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        obj.select_set(True)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
# Face normals are deterministic, including the custom arch's concave boundary strips.
for obj in bpy.context.selected_objects:
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / "south-gate.blend"))

for zone in ["SouthGate", "Guardhouse", "Gate", "Academic"]:
    for mat in list(bpy.data.materials):
        objects = [obj for obj in bpy.context.scene.objects
                   if obj.type == "MESH" and obj.name.startswith(zone)
                   and len(obj.data.materials) == 1 and obj.data.materials[0] == mat]
        if not objects:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        if len(objects) > 1:
            bpy.ops.object.join()
        bpy.context.object.name = zone + "_" + mat.name

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
# Plain-colour materials need no UV attribute. Remove unused coordinates before export.
for obj in bpy.context.selected_objects:
    if obj.type == "MESH":
        has_texture = any(mat and mat.use_nodes and
                          any(node.type == "TEX_IMAGE" for node in mat.node_tree.nodes)
                          for mat in obj.data.materials)
        if not has_texture:
            for uv in list(obj.data.uv_layers):
                obj.data.uv_layers.remove(uv)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT / "south-gate.glb"), export_format="GLB",
                          use_selection=True, export_yup=True, export_cameras=False,
                          export_lights=False, export_extras=True, export_image_format="AUTO")

objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
report = {
    "blenderVersion": bpy.app.version_string,
    "sourceKind": "reference-reconstruction",
    "sourceWebsite": "https://map.bjtu.edu.cn/",
    "sourceMarker": {"title": "南门", "panoramaTitle": "东校区南门", "x": 14763, "y": 13052},
    "unitsPerMetre": U,
    "runtimeMeshCount": len(objects),
    "triangles": sum(sum(len(p.vertices) - 2 for p in obj.data.polygons) for obj in objects),
    "materials": sorted({mat.name for obj in objects for mat in obj.data.materials}),
    "textures": [{"name": image.name, "width": image.size[0], "height": image.size[1]}
                 for image in bpy.data.images if image.type == "IMAGE" and image.packed_file],
    "glbBytes": (OUTPUT / "south-gate.glb").stat().st_size,
}
(OUTPUT / "asset-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Reimport the shipped GLB in a fresh scene to verify packaging and to render the actual export.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUTPUT / "south-gate.glb"))
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        obj.select_set(True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.world.color = (0.35, 0.35, 0.35)
box("PreviewGround", 16, 14, -0.08, 40, 34, 0.1, material("preview_grass", (0.29, 0.39, 0.21)))
bpy.ops.object.light_add(type="AREA", location=(2, -10, 24))
bpy.context.object.data.energy = 2600
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 16
bpy.ops.object.light_add(type="SUN", location=(0, 0, 20))
bpy.context.object.rotation_euler = (math.radians(30), math.radians(-20), math.radians(-35))
bpy.context.object.data.energy = 2
bpy.ops.object.camera_add(location=(30, -46, 32))
camera = bpy.context.object
camera.rotation_euler = (Vector((16, -16, 1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 31
scene.camera = camera
scene.render.filepath = str(ROOT / "artifacts/campus-3d/south-gate-blender-preview.png")
bpy.ops.render.render(write_still=True)
print("SOUTH_GATE_BUILD_REPORT " + json.dumps(report, ensure_ascii=False))
