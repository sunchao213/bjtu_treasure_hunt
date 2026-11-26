"""Export an already saved editable district after modelling, without rebuilding it."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets-source/campus-3d/district'
OUTPUT=ROOT/'public/assets/models/bjtu-district'
LAYOUT=json.loads((SOURCE/'layout.json').read_text(encoding='utf-8'))
U=32;DISTRICT=True;ASSET_NAME='district'
bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'district.blend'))
shared=(ROOT/'scripts/build_siyuan.py').read_text(encoding='utf-8')
exec(compile(shared[shared.index('# Keep three independent building zones;'):],
             'build_siyuan_export','exec'),globals())
