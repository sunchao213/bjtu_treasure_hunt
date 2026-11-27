"""Rebuild only Tianyou Hall from its shared footprint, preserving the district."""
import ast
import bpy
import json
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'assets-source/campus-3d/district'
LAYOUT = json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
U = LAYOUT['unitsPerMetre']
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
bpy.data.batch_remove(ids=tuple(o for o in bpy.context.scene.objects
    if o.name.startswith(('District_TianyouHall_', 'District_Landscape_paths'))))
tree = ast.parse((ROOT/'scripts/build_siyuan.py').read_text(encoding='utf-8'))
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
    and n.name in ['box', 'material', 'text']], type_ignores=[])
exec(compile(functions, 'shared_blender_helpers', 'exec'), globals())
environment = ast.parse((ROOT/'scripts/build_district_environment.py').read_text(encoding='utf-8'))
functions = ast.Module(body=[n for n in environment.body if isinstance(n, ast.FunctionDef)
    and n.name == 'union_paths'], type_ignores=[])
exec(compile(functions, 'path_helpers', 'exec'), globals())
base = bpy.data.materials['granite_base']
gold = bpy.data.materials['entrance_lettering']
building = next(b for b in LAYOUT['buildings'] if b['id'] == 'TianyouHall')
# Remove only trees covered by the extended footprint, including baked source meshes.
from mathutils import Vector
covered = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH' or not obj.name.startswith('District_Trees_'):
        continue
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    x = (min(v.x for v in corners)+max(v.x for v in corners))*U/2
    y = -(min(v.y for v in corners)+max(v.y for v in corners))*U/2
    if (building['x']-12 < x < building['x']+building['width']+12
            and building['y']-12 < y < building['y']+building['height']+12):
        covered.append(obj)
bpy.data.batch_remove(ids=tuple(covered))
runpy.run_path(str(ROOT/'scripts/build_campus_landmarks.py'))['build_tianyou'](globals(), building)
union_paths([r for r in LAYOUT['roads']+LAYOUT['paths'] if r['kind'] == 'path'],
            bpy.data.materials['district_paving'])
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'district.blend'))
runpy.run_path(str(ROOT/'scripts/export_campus_district.py'))
