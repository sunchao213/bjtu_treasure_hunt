"""Selectively rebuild photo-referenced landmarks, keeping refined campus buildings."""
import ast
import bpy
import json
import math
import runpy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets-source/campus-3d/district'
LAYOUT=json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
U=32;LANDSCAPE_ONLY=True;REBUILD_LANDMARKS=True
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
prefixes=('District_Ground_','District_Water_','District_Landscape_','District_Trees_',
          'District_Forecourt_','District_TianyouHall_','District_Library_','District_Sports_',
          'District_Teaching7_','District_MotorFleet_','District_Dormitory2_','District_Arts_')
bpy.data.batch_remove(ids=tuple(o for o in bpy.context.scene.objects if o.name.startswith(prefixes)))
shared=ast.parse((ROOT/'scripts/build_siyuan.py').read_text(encoding='utf-8'))
functions=ast.Module(body=[n for n in shared.body if isinstance(n,ast.FunctionDef)
                          and n.name in ['box','material','hip_roof','beam','text']],type_ignores=[])
exec(compile(functions,'shared_blender_helpers','exec'),globals())
wall=bpy.data.materials['ivory_stone'];roof=bpy.data.materials['flat_roof'];trim=bpy.data.materials['light_cornice']
base=bpy.data.materials['granite_base'];gold=bpy.data.materials['entrance_lettering']
glass=bpy.data.materials['recessed_blue_windows'];glass2=bpy.data.materials['blue_curtain_wall']
frame=bpy.data.materials['window_mullions'];metal=bpy.data.materials['blue_grey_metal_roof']
runpy.run_path(str(ROOT/'scripts/build_district_environment.py'),init_globals=globals())
bpy.context.scene['campus_landmarks_photo_v1']=True
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'district.blend'))
runpy.run_path(str(ROOT/'scripts/export_campus_district.py'))
