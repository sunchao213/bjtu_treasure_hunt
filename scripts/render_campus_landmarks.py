"""Render review views from the actual exported GLB, not the source viewport."""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/campus-3d/landmarks';OUT.mkdir(parents=True,exist_ok=True)
layout=json.loads((ROOT/'assets-source/campus-3d/district/layout.json').read_text(encoding='utf-8'))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/assets/models/bjtu-district/district.glb'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.color=(.42,.46,.45)
bpy.ops.object.light_add(type='SUN',location=(0,-40,100))
bpy.context.object.rotation_euler=(math.radians(25),math.radians(-20),math.radians(-35))
bpy.context.object.data.energy=2.2;bpy.context.object.data.angle=math.radians(10)
bpy.ops.object.light_add(type='AREA',location=(30,-40,70))
bpy.context.object.data.energy=12000;bpy.context.object.data.size=70
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
hall=next(a for a in layout['buildings'] if a['id']=='TianyouHall')
library=next(a for a in layout['buildings'] if a['id']=='Library')
def center(q): return ((q['x']+q['width']/2)/32,(q['y']+q['height']/2)/32)
hx,hy=center(hall);lx,ly=center(library)
f=layout['forecourt']['flag'];fx,fy=f['x']/32,f['y']/32
seventh=next(a for a in layout['buildings'] if a['id']=='Teaching7');sx,sy=center(seventh)
gx,gy=layout['seventhGarden']['statue']['x']/32,layout['seventhGarden']['statue']['y']/32
cx,cy=layout['seventhGarden']['clock']['x']/32,layout['seventhGarden']['clock']['y']/32
park=next(a for a in layout['parks'] if a['id']=='EastGarden');px,py=center(park)
views={
    'tianyou':((hx+30,-hy-14,18),(hx,-hy,3.7),24),
    'tianyou-name':((hx+20,-hy-2,6.5),(hx+7.1,-hy-2,2.9),7),
    'teaching7':((sx+12,-sy-17,33),(sx,-sy-5,2.0),38),
    'statue-clock':((gx+9,-gy-11,27),(gx,-(gy+cy)/2,1.7),14),
    'fanghua':((px-15,-py-20,27),(px,-py,0),30),
    'dormitory2':((16-13,-74-22,28),(19,-77,0),36),
    'library':((lx+16,-ly-32,22),(lx,-ly,6.7),28),
    'ming-lake':((52,-5,35),(69,-21,0),24),
    'flag':((fx+.6,-fy-8,7.0),(fx+.73,-fy,6.57),2.25),
    'courts':((16-13,-74-17,24),(16,-72.5,0),25),
}
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(views)
for name in selected:
    location,target,scale=views[name];camera.location=location
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
    scene.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
