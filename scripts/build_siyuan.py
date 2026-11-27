"""Blender source + GLB for the website-referenced Siyuan building.

Run: E:/Blender/blender.exe --background --factory-startup --python scripts/build_siyuan.py
Ground footprints are shared with the game. Heights/details are reference estimates.
"""
import bpy
import json
import math
import sys
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DISTRICT = '--district' in sys.argv
SOURCE = ROOT / ('assets-source/campus-3d/district' if DISTRICT else 'assets-source/campus-3d/siyuan')
OUTPUT = ROOT / ('public/assets/models/bjtu-district' if DISTRICT else 'public/assets/models/bjtu-siyuan')
ASSET_NAME = 'district' if DISTRICT else 'siyuan'
OUTPUT.mkdir(parents=True, exist_ok=True)
LAYOUT = json.loads((SOURCE / 'layout.json').read_text(encoding='utf-8'))
U = LAYOUT['unitsPerMetre']
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0

def material(name, rgb, roughness=.85, metal=0):
    mat=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color=(*rgb,1)
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(*rgb,1)
    bsdf.inputs['Roughness'].default_value=roughness
    bsdf.inputs['Metallic'].default_value=metal
    return mat

wall=material('ivory_stone',(.71,.72,.69))
trim=material('light_cornice',(.88,.86,.78))
base=material('granite_base',(.38,.39,.35))
roof=material('flat_roof',(.49,.54,.53))
metal=material('blue_grey_metal_roof',(.16,.26,.33),.6,.18)
glass=material('recessed_blue_windows',(.065,.16,.23),.42,.15)
glass2=material('blue_curtain_wall',(.045,.24,.39),.32,.23)
frame=material('window_mullions',(.31,.41,.46),.55,.12)
red=material('university_lettering',(.57,.025,.018))
gold=material('entrance_lettering',(.72,.5,.13),.5,.25)

def box(name,x,y,z,w,d,h,mat):
    # Direct data authoring avoids rebuilding Blender's entire dependency graph
    # for every window, which becomes quadratic for a whole campus district.
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(-w/2,-d/2,-h/2),(w/2,-d/2,-h/2),(w/2,d/2,-h/2),(-w/2,d/2,-h/2),
                      (-w/2,-d/2,h/2),(w/2,-d/2,h/2),(w/2,d/2,h/2),(-w/2,d/2,h/2)],[],
                     [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    mesh.materials.append(mat)
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.location=(x,-y,z)
    return obj

def text(name,value,x,y,z,size,mat):
    curve=bpy.data.curves.new(name,'FONT')
    curve.body=value
    curve.align_x='CENTER'
    curve.size=size
    curve.extrude=.007
    font=Path('C:/Windows/Fonts/simhei.ttf')
    if font.exists():
        curve.font=bpy.data.fonts.load(str(font))
    obj=bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    obj.location=(x,-y,z)
    obj.rotation_euler=(math.pi/2,0,0)
    curve.materials.append(mat)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)

def hip_roof(name,x,y,z,w,d,h):
    verts=[(x-w/2,-y-d/2,z),(x+w/2,-y-d/2,z),
           (x+w/2,-y+d/2,z),(x-w/2,-y+d/2,z),(x,-y,z+h)]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(3,2,1,0)])
    mesh.materials.append(metal)
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    # Visible roof seams, kept coarse at the gameplay camera scale.
    for i,(vx,vy,vz) in enumerate(verts[:4]):
        beam(name+'_rib', (vx,vy,vz+.035),(x,-y,z+h+.035),.035,frame)

def beam(name,a,b,r,mat):
    from mathutils import Vector
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6,radius=r,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object
    obj.name=name
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    obj.data.materials.append(mat)

for part in LAYOUT['parts']:
    name=part['id']
    x=(part['x']+part['width']/2)/U
    y=(part['y']+part['height']/2)/U
    w,d,h=part['width']/U,part['height']/U,part['elevation']
    front=y+d/2
    box(name+'_mass',x,y,h/2,w,d,h,wall)
    box(name+'_base',x,y,.40,w+.06,d+.06,.8,base)
    box(name+'_roof',x,y,h+.10,w+.18,d+.18,.20,roof)
    for z in [1.3,h-.20]:
        box(name+'_cornice',x,y,z,w+.16,d+.16,.12,trim)
    # Opaque recess panels + stone sills, no transparent walls or baked shadows.
    floors=part['floors']
    cols=12 if name=='Main' else 14
    step=(w-.8)/cols
    pitch=(h-1.7)/floors
    for floor in range(floors):
        z=1.6+pitch*(floor+.5)
        for col in range(cols):
            wx=x-w/2+.4+step*(col+.5)
            # Central blue curtain wall replaces the middle two window columns.
            if (name=='Main' and abs(wx-x)<w*.12) or (name=='West' and wx>x+w*.36) or (name=='East' and wx<x-w*.36):
                continue
            for side in [-1,1]:
                fy=y+side*(d/2+.018)
                box(name+'_window',wx,fy,z,step*.64,.045,pitch*.62,glass)
                box(name+'_sill',wx,fy+side*.035,z-pitch*.34,step*.75,.10,.065,trim)
        for side in [-1,1]:
            for j in range(3):
                box(name+'_side_window',x+side*(w/2+.02),y-d/2+(j+1)*d/4,z,
                    .045,d*.16,pitch*.62,glass)
    tower_w=1.22 if name=='Main' else 1.05
    tower_h=h+(.9 if name=='Main' else .65)
    # Main: two end towers. West: right tower only. East: left tower only.
    tower_sides=[-1,1] if name=='Main' else ([1] if name=='West' else [-1])
    for side in tower_sides:
        tx=x+side*(w/2-tower_w*.55)
        box(name+'_tower',tx,front-.24,tower_h/2,tower_w,.76,tower_h,trim)
        box(name+'_tower_glass',tx,front+.15,tower_h-1.1,tower_w*.70,.04,.6,glass2)
        hip_roof(name+'_pyramid',tx,front-.22,tower_h,tower_w+0.13,1.05,1.05)
    if name in ['West','East']:
        # Each side building has its own asymmetrical blue-glazed stair bay.
        # This projects out of its OWN facade; it never bridges the road to Main.
        side=1 if name=='West' else -1
        tx=x+side*(w/2-tower_w*.55)
        bayw=1.28
        box(name+'_stair_bay',tx,front-.12,h*.49,bayw,.56,h*.98,trim)
        box(name+'_stair_glass',tx,front+.18,h*.49,bayw*.64,.035,h*.86,glass2)
        for floor in range(floors*2):
            box(name+'_stair_transom',tx,front+.21,.6+floor*h/(floors*2),bayw*.64,.045,.025,frame)
        for offset in [-.22,0,.22]:
            box(name+'_stair_mullion',tx+offset,front+.21,h*.49,.025,.045,h*.86,frame)
        box(name+'_door',tx,front+.24,.65,.83,.06,1.3,glass)
        box(name+'_door_canopy',tx,front+.59,1.55,1.65,1.12,.10,trim)
        for offset in [-.64,.64]:
            box(name+'_porch_column',tx+offset,front+.95,.73,.10,.10,1.46,trim)
        # Offset rear service roof and flat rooftop utility box, from user images.
        rx=x+(-.22 if name=='West' else .18)*w
        box(name+'_roof_utility',rx,y-d*.28,h+.44,1.65,.90,.48,trim)
        box(name+'_roof_utility_cap',rx,y-d*.28,h+.72,1.80,1.0,.09,roof)
        if name=='West':
            for vent_x in [-.35,0,.35]:
                box(name+'_roof_vent',x-w*.43+vent_x,front-.60,h+.4,.16,.4,.4,trim)
        else:
            for offset in [-.26,.26]:
                box(name+'_roof_vent',x+w*.42+offset,y-d*.26,h+.4,.18,.42,.4,trim)
        text(name+'_name', '思源西楼' if name=='West' else '思源东楼',
             x,front+.055,1.12,.31,gold)
        # Sparse small upper windows give the flat parapet its distinctive profile.
        for i in range(8):
            wx=x-w*.39+i*w*.78/7
            box(name+'_clerestory',wx,front+.025,h-.34,.24,.035,.15,glass)
    if name=='Main':
        cw=w*.22
        box(name+'_curtain',x,front+.045,h*.49,cw,.055,h*.83,glass2)
        for col in range(7):
            box(name+'_mullion',x-cw/2+cw*col/6,front+.09,h*.49,.035,.055,h*.83,frame)
        for floor in range(floors*2):
            box(name+'_transom',x,front+.09,1.45+floor*pitch/2,cw,.055,.035,frame)
        # Ground entrance in the actual central frontage, with shallow passable steps.
        box(name+'_entry',x,front+.12,.88,2.4,.20,1.76,glass)
        box(name+'_entry_lintel',x,front+.28,1.72,2.9,.22,.28,trim)
        hip_roof(name+'_entrance_canopy',x,front+.70,1.94,3.3,1.7,.8)
        for i in range(3):
            box(name+'_step',x,front+.95+i*.2,.07-i*.02,3.2,.65,.045,trim)
        text(name+'_name','思 源 楼',x,front+.42,1.73,.27,gold)
        text(name+'_university','北 京 交 通 大 学',x,front+.12,h-.82,.65,red)
        # Distinctive broad polygonal roof pavilion, spire and cap.
        bpy.ops.mesh.primitive_cone_add(vertices=16,radius1=2.50,radius2=.16,depth=2.5,
                                      location=(x,-y,h+1.5))
        bpy.context.object.name=name+'_central_pavilion'
        bpy.context.object.data.materials.append(metal)
        for i in range(16):
            a=2*math.pi*i/16
            beam(name+'_pavilion_rib',(x+2.5*math.cos(a),-y+2.5*math.sin(a),h+.27),
                 (x,-y,h+2.77),.026,frame)
        beam(name+'_spire',(x,-y,h+2.7),(x,-y,h+4.0),.055,metal)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.18,location=(x,-y,h+3.2))
        bpy.context.object.name=name+'_spire_cap'
        bpy.context.object.data.materials.append(trim)

if DISTRICT:
    runpy.run_path(str(ROOT/'scripts/build_district_environment.py'), init_globals=globals())
    bpy.context.scene['official_forecourt_layout_v1']='forecourt' in LAYOUT

for obj in bpy.context.scene.objects:
    if obj.type=='MESH':
        obj['source']='reference-reconstruction:map.bjtu.edu.cn/'+ASSET_NAME
        obj['collision']='external:'+str(SOURCE.relative_to(ROOT)/'layout.json')
bpy.ops.object.select_all(action='SELECT')
from mathutils import Vector, Quaternion
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_location=(51,-52,3) if DISTRICT else (29,-23,6)
            area.spaces.active.region_3d.view_distance=150 if DISTRICT else 53
            area.spaces.active.region_3d.view_rotation=Quaternion((1,0,0),math.radians(35))
            area.spaces.active.region_3d.view_perspective='ORTHO'
cx,cy,distance=(51,52,155) if DISTRICT else (29,24,70)
bpy.ops.object.camera_add(location=(cx,-cy-distance*math.cos(math.radians(55)),distance*math.sin(math.radians(55))))
camera=bpy.context.object
camera.name='Preview_Fixed55DegreeCamera'
camera.rotation_euler=(Vector((cx,-cy,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=165 if DISTRICT else 64
if DISTRICT:
    bpy.context.scene.render.resolution_x=1400
    bpy.context.scene.render.resolution_y=1100
bpy.context.scene.camera=camera
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/(ASSET_NAME+'.blend')))

# Keep three independent building zones; batch by material within each building.
def join_plain_meshes(objects, name):
    """World-space geometry batch without repeatedly rebuilding Blender's graph.

    Runtime assets use plain materials and discard UVs below. The editable .blend
    has already been saved with separate objects, so this only changes the export.
    """
    if len(objects)==1:
        objects[0].name=name
        return
    vertices=[];faces=[]
    mat=objects[0].data.materials[0]
    extras=dict(objects[0].items())
    for obj in objects:
        offset=len(vertices);matrix=obj.matrix_world.copy()
        vertices.extend([tuple(matrix@v.co) for v in obj.data.vertices])
        faces.extend([tuple(offset+i for i in p.vertices) for p in obj.data.polygons])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(mat)
    result=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(result)
    for key,value in extras.items(): result[key]=value
    bpy.data.batch_remove(ids=tuple(objects))

bpy.context.view_layer.update()
for zone in [p['id'] for p in LAYOUT['parts']]:
    for mat in list(bpy.data.materials):
        objs=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith(zone+'_')
              and len(o.data.materials)==1 and o.data.materials[0]==mat]
        if not objs:
            continue
        join_plain_meshes(objs,'Siyuan_'+zone+'_'+mat.name)
if DISTRICT:
    zones={obj.name.split('_')[1] for obj in bpy.context.scene.objects
           if obj.type=='MESH' and obj.name.startswith('District_')}
    for zone in sorted(zones):
        for mat in list(bpy.data.materials):
            objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH'
                     and obj.name.startswith('District_'+zone+'_')
                     and len(obj.data.materials)==1 and obj.data.materials[0]==mat]
            if not objects: continue
            join_plain_meshes(objects,'District_'+zone+'_'+mat.name)
for obj in bpy.context.scene.objects:
    if obj.type=='MESH':
        for uv in list(obj.data.uv_layers):
            obj.data.uv_layers.remove(uv)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/(ASSET_NAME+'.glb')),export_format='GLB',
                          use_selection=True,export_yup=True,export_extras=True,
                          export_cameras=False,export_lights=False)
objs=[o for o in bpy.context.scene.objects if o.type=='MESH']
report=dict(blenderVersion=bpy.app.version_string,sourceKind='reference-reconstruction',
            runtimeMeshCount=len(objs),
            triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs),
            materials=sorted({m.name for o in objs for m in o.data.materials}),textures=[],
            glbBytes=(OUTPUT/(ASSET_NAME+'.glb')).stat().st_size,
            unitsPerMetre=U,footprints=(SOURCE.relative_to(ROOT)/'layout.json').as_posix())
(OUTPUT/'asset-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('SIYUAN_BUILD_REPORT '+json.dumps(report))
