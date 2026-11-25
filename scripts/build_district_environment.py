"""Executed inside the shared Blender authoring context by build_siyuan.py --district.

All ground extents originate in district/layout.json. Mesh names retain building
identity for separate occlusion, bounds verification and material batching.
"""
from mathutils import Vector, Matrix
import bmesh
import random
random.seed(20261120)

brick=material('district_red_brick',(.48,.16,.11))
redroof=material('district_terracotta',(.64,.13,.065))
beige=material('district_sand_stone',(.76,.64,.44))
grass=material('district_grass',(.24,.38,.15))
grasslight=material('district_lawn',(.31,.46,.20))
asphalt=material('district_asphalt',(.19,.23,.23))
walkway=material('district_paving',(.60,.49,.37))
courtmat=material('district_court_blue',(.08,.30,.40))
watermat=material('district_lake',(.07,.34,.44),.4,.1)
bank=material('district_shore_stone',(.54,.63,.57))
trunkmat=material('district_bark',(.29,.20,.12))
leaves=[material('district_leaf_summer',(.22,.39,.16)),material('district_leaf_gold',(.58,.42,.10)),material('district_leaf_conifer',(.13,.31,.21))]

def ground(name,r,mat,z=.005):
    return box(name,(r['x']+r['width']/2)/U,(r['y']+r['height']/2)/U,z,
               r['width']/U,r['height']/U,.012,mat)

def polygon(name,points,mat,z=.02):
    verts=[(p['x']/U,-p['y']/U,z) for p in points]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],[list(reversed(range(len(verts))))])
    mesh.materials.append(mat)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    return obj

def road_segment(name,a,b,width,mat,z):
    dx,dy=(b['x']-a['x'])/U,(b['y']-a['y'])/U
    obj=box(name,(a['x']+b['x'])/(2*U),(a['y']+b['y'])/(2*U),z,
            math.hypot(dx,dy),width/U,.012,mat)
    obj.rotation_euler.z=-math.atan2(dy,dx)
    return obj

def union_roads(name,roads,extra,mat,z):
    """Non-overlapping planar rectangles: no coplanar faces at intersections."""
    rectangles=[]
    for road in roads:
        radius=(road['width']+extra)/2
        for a,b in zip(road['points'],road['points'][1:]):
            if a['x']==b['x']:
                rectangles.append((a['x']-radius,min(a['y'],b['y']),a['x']+radius,max(a['y'],b['y'])))
            elif a['y']==b['y']:
                rectangles.append((min(a['x'],b['x']),a['y']-radius,max(a['x'],b['x']),a['y']+radius))
    xs=sorted({r[i] for r in rectangles for i in [0,2]})
    ys=sorted({r[i] for r in rectangles for i in [1,3]})
    vertices=[];faces=[]
    for x0,x1 in zip(xs,xs[1:]):
        for y0,y1 in zip(ys,ys[1:]):
            x,y=(x0+x1)/2,(y0+y1)/2
            if not any(a<=x<=c and b<=y<=d for a,b,c,d in rectangles): continue
            n=len(vertices)
            vertices.extend([(x0/U,-y0/U,z),(x1/U,-y0/U,z),(x1/U,-y1/U,z),(x0/U,-y1/U,z)])
            faces.append((n+3,n+2,n+1,n))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.materials.append(mat)
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    return obj

def union_paths(paths,mat,z=.070):
    """Sweep convex path ribbons into disjoint trapezoids; joins cannot z-fight."""
    polygons=[];joints={}
    for road in paths:
        r=road['width']/2
        for a,b in zip(road['points'],road['points'][1:]):
            dx,dy=b['x']-a['x'],b['y']-a['y'];length=math.hypot(dx,dy)
            if length<.001: continue
            nx,ny=-dy/length*r,dx/length*r
            polygons.append([(a['x']+nx,a['y']+ny),(b['x']+nx,b['y']+ny),
                             (b['x']-nx,b['y']-ny),(a['x']-nx,a['y']-ny)])
        for p in road['points']:
            key=(p['x'],p['y']);joints[key]=max(r,joints.get(key,0))
    for (x,y),r in joints.items():
        polygons.append([(x+r*math.cos(i*math.pi/4),y+r*math.sin(i*math.pi/4)) for i in range(8)])
    edges=[];levels=set()
    for poly in polygons:
        poly_edges=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            levels.add(round(a[1],7))
            if abs(a[1]-b[1])<1e-8: continue
            slope=(b[0]-a[0])/(b[1]-a[1]);intercept=a[0]-slope*a[1]
            edge=(min(a[1],b[1]),max(a[1],b[1]),slope,intercept)
            edges.append(edge);poly_edges.append(edge)
        poly[:]=poly_edges
    for i,a in enumerate(edges):
        for b in edges[i+1:]:
            if abs(a[2]-b[2])<1e-9: continue
            low,high=max(a[0],b[0]),min(a[1],b[1])
            if high<=low: continue
            y=(b[3]-a[3])/(a[2]-b[2])
            if low+1e-7<y<high-1e-7: levels.add(round(y,7))
    ys=sorted(levels);vertices=[];faces=[]
    def xx(edge,y): return edge[2]*y+edge[3]
    for y0,y1 in zip(ys,ys[1:]):
        if y1-y0<1e-7: continue
        mid=(y0+y1)/2;intervals=[]
        for poly in polygons:
            active=[e for e in poly if e[0]<mid<e[1]]
            if len(active)<2: continue
            active.sort(key=lambda e:xx(e,mid));intervals.append((active[0],active[-1]))
        intervals.sort(key=lambda pair:xx(pair[0],mid));merged=[]
        for left,right in intervals:
            if merged and xx(left,mid)<=xx(merged[-1][1],mid)+1e-6:
                if xx(right,mid)>xx(merged[-1][1],mid): merged[-1]=(merged[-1][0],right)
            else: merged.append((left,right))
        for left,right in merged:
            n=len(vertices)
            vertices += [(xx(left,y0)/U,-y0/U,z),(xx(right,y0)/U,-y0/U,z),
                         (xx(right,y1)/U,-y1/U,z),(xx(left,y1)/U,-y1/U,z)]
            if xx(right,mid)-xx(left,mid)>1e-6: faces.append((n+3,n+2,n+1,n))
    data=bpy.data.meshes.new('District_Landscape_paths');data.from_pydata(vertices,[],faces);data.materials.append(mat)
    ob=bpy.data.objects.new('District_Landscape_paths',data);bpy.context.collection.objects.link(ob)

def roof_gable(name,x,y,z,w,d,along_x=True):
    lift=min(w,d)*.28
    verts=[(x-w/2,-y-d/2,z),(x+w/2,-y-d/2,z),(x+w/2,-y+d/2,z),(x-w/2,-y+d/2,z)]
    if along_x:
        verts += [(x-w/2,-y,z+lift),(x+w/2,-y,z+lift)]
        faces=[(0,1,5,4),(4,5,2,3),(0,4,3),(1,2,5),(3,2,1,0)]
    else:
        verts += [(x,-y-d/2,z+lift),(x,-y+d/2,z+lift)]
        faces=[(0,4,5,3),(4,1,2,5),(0,1,4),(3,5,2),(3,2,1,0)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(redroof)
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)

def block_facade(zone,b,kind):
    x,y=(b['x']+b['width']/2)/U,(b['y']+b['height']/2)/U
    w,d,h=b['width']/U,b['height']/U,b['elevation']
    wallmat=beige if kind in ['courtyard','hall','service'] else brick if kind.startswith('red') else wall
    box(zone+'_mass',x,y,h/2,w,d,h,wallmat)
    box(zone+'_base',x,y,.20,w+.08,d+.08,.4,base)
    if kind=='red-gable': roof_gable(zone+'_gable',x,y,h+.05,w+.22,d+.22,w>d)
    else: box(zone+'_roof',x,y,h+.10,w+.15,d+.15,.2,roof)
    for side in [-1,1]:
        for axis,length,depth in [('u',w,d),('v',d,w)]:
            cols=max(2,int(length/.75))
            for floor in range(b['floors']):
                z=.65+(h-.9)/b['floors']*(floor+.5)
                for col in range(cols):
                    offset=-length/2+length*(col+.5)/cols
                    if axis=='u':
                        box(zone+'_window',x+offset,y+side*(d/2+.022),z,
                            length/cols*.58,.035,(h-.9)/b['floors']*.53,glass)
                    else:
                        box(zone+'_window',x+side*(w/2+.022),y+offset,z,
                            .035,length/cols*.58,(h-.9)/b['floors']*.53,glass)
        for floor in range(b['floors']+1):
            box(zone+'_belt',x,y,.45+floor*(h-.5)/b['floors'],w+.10,d+.10,.07,trim)
    if kind.startswith('red'):
        length=max(w,d)
        for i in range(max(2,int(length/.9))+1):
            t=-length/2+i*length/max(2,int(length/.9))
            if w>d:
                for side in [-1,1]: box(zone+'_pilaster',x+t,y+side*(d/2+.045),h/2,.07,.08,h,trim)
            else:
                for side in [-1,1]: box(zone+'_pilaster',x+side*(w/2+.045),y+t,h/2,.08,.07,h,trim)
    return x,y,w,d,h

ground('District_Ground_base',dict(x=-150,y=-150,width=3550,height=3650),grass,-.04)
for park in LAYOUT['parks']:
    if 'forecourt' in LAYOUT and park['id'] in ['CentralLawn','SouthGarden']: continue
    ground('District_Landscape_lawn',park,grasslight)
for road in LAYOUT['roads']+LAYOUT['paths']:
    for a,b in zip(road['points'],road['points'][1:]):
        if road['kind']=='road':
            if a['x']!=b['x'] and a['y']!=b['y']:
                # Short diagonal links between the lawn lanes and plaza lanes.
                road_segment('District_Ground_diagonal_curb',a,b,road['width']+14,walkway,.021)
                road_segment('District_Ground_diagonal_road',a,b,road['width'],asphalt,.035)
            length=math.hypot(b['x']-a['x'],b['y']-a['y'])
            for offset in range(30,int(length)-20,80):
                t=offset/length; end=min(1,(offset+22)/length)
                p1=dict(x=a['x']+(b['x']-a['x'])*t,y=a['y']+(b['y']-a['y'])*t)
                p2=dict(x=a['x']+(b['x']-a['x'])*end,y=a['y']+(b['y']-a['y'])*end)
                road_segment('District_Ground_dashes',p1,p2,2.6,trim,.04)
        # Walkways are unioned below instead of stacking coplanar ribbons.
road_network=[r for r in LAYOUT['roads'] if r['kind']=='road']
union_roads('District_Ground_curb',road_network,14,walkway,.020)
union_roads('District_Ground_road',road_network,0,asphalt,.033)
union_paths([r for r in LAYOUT['roads']+LAYOUT['paths'] if r['kind']=='path'],walkway)

import runpy
landmarks=runpy.run_path(str(ROOT/'scripts/build_campus_landmarks.py'))
landmarks['build_ming_lake'](globals())

for a in LAYOUT['buildings']:
    if globals().get('LANDSCAPE_ONLY',False) and not (globals().get('REBUILD_LANDMARKS',False) and a['id'] in ['TianyouHall','Library','Teaching7','Dormitory2']): continue
    if a['kind']=='siyuan': continue
    zone='District_'+a['id']
    if a['id']=='Dormitory2':
        runpy.run_path(str(ROOT/'scripts/build_dormitory2.py'))['build_dormitory2'](globals(),a)
        continue
    if a['kind']=='teaching9':
        import runpy
        runpy.run_path(str(ROOT/'scripts/build_teaching9.py'))['build_teaching9'](globals(), a)
        continue
    if a['kind']=='library':
        landmarks['build_library'](globals(),a)
        continue
    if a['kind']=='hall':
        landmarks['build_tianyou'](globals(),a)
        continue
    if a['kind']=='teaching7':
        runpy.run_path(str(ROOT/'scripts/build_campus_gardens.py'))['build_teaching7'](globals(),a)
        continue
    for b in a['blocks']:
        x,y,w,d,h=block_facade(zone,b,a['kind'])
    if a['kind']=='courtyard':
        b=a['blocks'][3]
        x,y=(b['x']+b['width']/2)/U,(b['y']+b['height'])/U
        box(zone+'_entry_glass',x,y+.05,2.1,2.8,.08,4.2,glass)
        for side in [-1,1]:
            box(zone+'_portico',x+side*1.9,y+.34,2.4,.65,.8,4.8,trim)
        box(zone+'_portico_beam',x,y+.34,4.8,4.9,.9,.45,trim)
        hip_roof(zone+'_portico_roof',x,y+.40,5.0,5.4,1.6,1.1)
        ground(zone+'_courtyard',dict(x=a['x']+140,y=a['y']+140,width=a['width']-280,height=a['height']-280),walkway,.03)

if not globals().get('LANDSCAPE_ONLY',False) or globals().get('REBUILD_LANDMARKS',False):
    landmarks['build_basketball'](globals())

# Reference-rebuilt red south arch from the existing editable source.
gate_objects=[]
if not globals().get('LANDSCAPE_ONLY',False):
    with bpy.data.libraries.load(str(ROOT/'assets-source/campus-3d/south-gate.blend'),link=False) as (data_from,data_to):
        data_to.objects=[name for name in data_from.objects if name.startswith('SouthGate_')]
    gate_objects=data_to.objects
gate=LAYOUT['gate'];gx,gy=gate['x']/U,gate['y']/U
for obj in gate_objects:
    if obj is None: continue
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.update()
    # Apply the authoring transform directly to vertex positions; no giant parent bounds.
    world=obj.matrix_world.copy()
    for vertex in obj.data.vertices:
        co=world@vertex.co
        vertex.co=((co.x-16)*(gate['width']/224)+gx,(co.y+22)*(gate['depth']/28)-gy,co.z*.8)
    obj.matrix_world=Matrix.Identity(4)
    obj.name='District_SouthGate_'+obj.name
    for mat in obj.data.materials:
        if mat and mat.use_nodes:
            for node in list(mat.node_tree.nodes):
                if node.type=='TEX_IMAGE': mat.node_tree.nodes.remove(node)

# Pavilions, sculpture plazas and small planted gardens enrich the reference layout.
def feature_xy(u,v): return ((842+u*1.55)/32,(946+v*1.55)/32)
if 'fanghua' in LAYOUT:
    runpy.run_path(str(ROOT/'scripts/build_campus_gardens.py'))['build_gardens'](globals())

for tree in LAYOUT['trees']:
    x,y=tree['x']/U,tree['y']/U
    box('District_Trees_trunk',x,y,.70,.17,.17,1.4,trunkmat)
    mesh=bpy.data.meshes.new('District_Trees_crown');bm=bmesh.new()
    if tree['variant']==2:
        bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=7,radius1=.9,radius2=0,depth=2.6)
    else: bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1.1)
    bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new('District_Trees_crown',mesh);bpy.context.collection.objects.link(obj)
    obj.location=(x,-y,2.0 if tree['variant']==2 else 1.95)
    obj.data.materials.append(leaves[tree['variant']%3])
    if tree['variant']==3:
        # Drooping low-poly willow clusters around Ming Lake.
        obj.scale=(1.1,1.1,.85)
        for i in range(5):
            mesh=bpy.data.meshes.new('District_Trees_willow');bm=bmesh.new()
            bmesh.ops.create_icosphere(bm,subdivisions=1,radius=.48);bm.to_mesh(mesh);bm.free()
            ob=bpy.data.objects.new('District_Trees_willow',mesh);bpy.context.collection.objects.link(ob)
            ob.location=(x+.70*math.cos(i*math.tau/5),-y+.70*math.sin(i*math.tau/5),1.45)
            ob.scale=(.75,.75,1.6);ob.data.materials.append(leaves[0])

if 'forecourt' in LAYOUT:
    import runpy
    runpy.run_path(str(ROOT/'scripts/build_forecourt.py'))['build_forecourt'](globals())

# Apply ground transforms before source save; polygons are consistently front-faced.
for obj in list(bpy.context.scene.objects):
    if obj.type=='MESH' and obj.name.startswith('District_') and not (globals().get('LANDSCAPE_ONLY',False) and
        not obj.name.startswith(('District_Ground_','District_Water_','District_Landscape_','District_Trees_','District_Forecourt_')+
                               (('District_TianyouHall_','District_Library_','District_Sports_','District_Teaching7_','District_Dormitory2_') if globals().get('REBUILD_LANDMARKS',False) else ()))):
        obj.data.transform(obj.matrix_basis)
        obj.matrix_basis=Matrix.Identity(4)
