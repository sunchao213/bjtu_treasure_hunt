"""Rebuild only apartment two and shared path paving; preserve other landmarks."""
import ast
import json
import math
import runpy
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'assets-source/campus-3d/district'
LAYOUT = json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
U = LAYOUT['unitsPerMetre']
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
bpy.data.batch_remove(ids=tuple(o for o in bpy.context.scene.objects
    if o.name.startswith(('District_Dormitory2_', 'District_Landscape_paths'))))

def load_functions(filename, names):
    tree = ast.parse((ROOT/'scripts'/filename).read_text(encoding='utf-8'))
    functions = ast.Module(body=[n for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[])
    exec(compile(functions, filename, 'exec'), globals())

load_functions('build_siyuan.py', ['box', 'material'])
load_functions('build_district_environment.py', ['union_paths'])
trim = bpy.data.materials['light_cornice']
base = bpy.data.materials['granite_base']
glass = bpy.data.materials['recessed_blue_windows']
frame = bpy.data.materials['window_mullions']
roof = bpy.data.materials['flat_roof']
walkway = bpy.data.materials['district_paving']
building = next(b for b in LAYOUT['buildings'] if b['id'] == 'Dormitory2')
runpy.run_path(str(ROOT/'scripts/build_dormitory2.py'))['build_dormitory2'](globals(), building)
union_paths([r for r in LAYOUT['roads']+LAYOUT['paths'] if r['kind'] == 'path'], walkway)
bpy.context.scene['dormitory2_plaza_clearance_v1'] = True
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'district.blend'))
runpy.run_path(str(ROOT/'scripts/export_campus_district.py'))
