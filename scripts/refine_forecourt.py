"""Rebuild ground/landscape from the official site trace, preserving authored buildings."""
import ast,bpy,json,runpy,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets-source/campus-3d/district'
LAYOUT=json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
U=32;LANDSCAPE_ONLY=True
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
remove=[o for o in bpy.context.scene.objects if o.name.startswith(('District_Ground_','District_Water_',
    'District_Landscape_','District_Trees_','District_Forecourt_'))]
bpy.data.batch_remove(ids=tuple(remove))
# Idempotent translations to the traced lawn/plaza neighbourhood. This marker is
# saved in the editable source, so repeated refinement cannot accumulate offsets.
if not bpy.context.scene.get('official_forecourt_layout_v1',False):
    shifts={'Teaching7':105,'Teaching9':185,'Arts':185,'Admissions':210,'Security':210}
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH' and obj.name.startswith('District_'):
            zone=obj.name.split('_')[1]
            if zone in shifts: obj.location.x+=shifts[zone]*1.55/U
    bpy.context.scene['official_forecourt_layout_v1']=True
shared=(ROOT/'scripts/build_siyuan.py').read_text(encoding='utf-8')
tree=ast.parse(shared)
functions=ast.Module(body=[node for node in tree.body if isinstance(node,ast.FunctionDef)
                          and node.name in ['box','material','hip_roof','beam','text']],type_ignores=[])
exec(compile(functions,'shared_blender_helpers','exec'),globals())
wall=bpy.data.materials['ivory_stone'];roof=bpy.data.materials['flat_roof'];trim=bpy.data.materials['light_cornice']
gold=bpy.data.materials['entrance_lettering'];glass=bpy.data.materials['recessed_blue_windows']
glass2=bpy.data.materials['blue_curtain_wall'];frame=bpy.data.materials['window_mullions'];metal=bpy.data.materials['blue_grey_metal_roof']
runpy.run_path(str(ROOT/'scripts/build_district_environment.py'),init_globals=globals())
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'district.blend'))
runpy.run_path(str(ROOT/'scripts/export_campus_district.py'))
