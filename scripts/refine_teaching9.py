"""Update only Teaching 9 in the editable district; re-export the full runtime GLB.

blender --background --factory-startup --python scripts/refine_teaching9.py
The full build uses the same builder via build_district_environment.py.
"""
import ast
import bpy
import json
from pathlib import Path
import runpy

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets-source/campus-3d/district'
OUTPUT=ROOT/'public/assets/models/bjtu-district'
LAYOUT=json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
DISTRICT=True;ASSET_NAME='district';U=32
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
remove=[]
for obj in list(bpy.context.scene.objects):
    if obj.name.startswith('District_Teaching9_'): remove.append(obj)
    # This source was authored before the new side entrance path. Remove only the
    # tree occupying that entrance; leave the rest of the district intact.
    elif obj.name.startswith('District_Trees_'):
        center=sum((obj.matrix_world@v.co for v in obj.data.vertices),__import__('mathutils').Vector())/len(obj.data.vertices)
        if abs(center.x-1066.75/U)<.15 and abs(center.y+2282.1/U)<.15:
            remove.append(obj)
bpy.data.batch_remove(ids=tuple(remove))
# Reuse authoring functions without running the surrounding full scene setup.
shared=(ROOT/'scripts/build_siyuan.py').read_text(encoding='utf-8')
tree=ast.parse(shared)
functions=ast.Module(body=[node for node in tree.body if isinstance(node,ast.FunctionDef)
                          and node.name in ['box','material']],type_ignores=[])
exec(compile(functions,'build_siyuan_functions','exec'),globals())
building=next(a for a in LAYOUT['buildings'] if a['id']=='Teaching9')
runpy.run_path(str(ROOT/'scripts/build_teaching9.py'))['build_teaching9'](globals(),building)
path=next(p for p in LAYOUT['paths'] if p['name']=='第九教学楼侧门步道')
for a,b in zip(path['points'],path['points'][1:]):
    if not bpy.data.objects.get('District_Landscape_teaching9_sidepath'):
        box('District_Landscape_teaching9_sidepath',(a['x']+b['x'])/(2*U),
            (a['y']+b['y'])/(2*U),.022,abs(b['x']-a['x'])/U,path['width']/U,.012,
            bpy.data.materials['district_paving'])
for obj in bpy.context.scene.objects:
    if obj.name.startswith('District_Teaching9_'):
        obj['source']='user-reference-reconstruction:teaching9-front-side'
        obj['collision']='external:assets-source/campus-3d/district/layout.json'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'district.blend'))
tail=shared[shared.index('# Keep three independent building zones;'):]
exec(compile(tail,'build_siyuan_export','exec'),globals())
