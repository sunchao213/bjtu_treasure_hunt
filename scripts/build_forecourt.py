"""Official-map and on-site panorama based Siyuan lawn / south-gate plaza."""
import math
import bmesh

def build_forecourt(ctx):
    bpy=ctx['bpy'];box=ctx['box'];material=ctx['material'];U=ctx['U'];data=ctx['LAYOUT']['forecourt']
    ground=ctx['ground'];polygon=ctx['polygon'];road_segment=ctx['road_segment']
    lawnmat=material('forecourt_lawn',(.19,.37,.12))
    paving=material('forecourt_sand_paving',(.63,.58,.40))
    brick=material('forecourt_red_border',(.48,.25,.20))
    stone=material('forecourt_limestone',(.69,.70,.62))
    dark=material('forecourt_monument_metal',(.26,.25,.19),.55,.3)
    flowers=material('forecourt_red_flowers',(.61,.08,.07))
    silver=material('forecourt_pole',(.58,.62,.64),.4,.6)
    flagmat=material('forecourt_flag_red',(.68,.025,.015))
    grass=ctx['grasslight'];trim=ctx['trim']
    def b(name,*args): return box('District_Forecourt_'+name,*args)
    def cylinder(name,x,y,z,radius,depth,mat,vertices=32):
        mesh=bpy.data.meshes.new(name);bm=bmesh.new()
        bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=vertices,radius1=radius,radius2=radius,depth=depth)
        bm.to_mesh(mesh);bm.free();mesh.materials.append(mat)
        obj=bpy.data.objects.new('District_Forecourt_'+name,mesh);bpy.context.collection.objects.link(obj)
        obj.location=(x,-y,z)
        return obj
    def ring(name,x,y,z,outer,inner,mat):
        verts=[]
        for radius in [outer,inner]:
            verts += [(x+radius*math.cos(i*math.pi/24),-y+radius*math.sin(i*math.pi/24),z) for i in range(48)]
        faces=[(i,(i+1)%48,(i+1)%48+48,i+48) for i in range(48)]
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(mat)
        obj=bpy.data.objects.new('District_Forecourt_'+name,mesh);bpy.context.collection.objects.link(obj)
    lawn=data['lawn']
    # A continuous lawn with two notches; no erroneous north-south asphalt through it.
    polygon('District_Forecourt_lawn',lawn['polygon'],lawnmat,.048)
    for a,c in zip(lawn['polygon'],lawn['polygon'][1:]+lawn['polygon'][:1]):
        road_segment('District_Forecourt_lawn_edging',a,c,3.0,stone,.053)
    # Fine mottling preserves the open space rather than replacing it with dense trees.
    # Geometry strips are very sparse; variation reads at the original fixed overview.
    for i in range(14):
        x=lawn['x']+25+(i*79)%int(lawn['width']-50)
        y=lawn['y']+100+(i*117)%int(lawn['height']-200)
        ground('District_Forecourt_grass_variation',dict(x=x,y=y,width=13,height=3),grass,.049)
    apron=data['siyuanApron']
    ground('District_Forecourt_flag_apron',apron,ctx['asphalt'],.044)
    f=data['flag'];fx,fy=f['x']/U,f['y']/U
    ground('District_Forecourt_flag_pad',dict(x=f['x']-23,y=f['y']-40,width=46,height=65),stone,.056)
    cylinder('flag_base',fx,fy,.10,.28,.20,stone,8)
    cylinder('flag_pole',fx,fy,f['height']/2,.035,f['height'],silver,10)
    # PRC flag: 3:2 field; official 30 x 20 grid, four points face the large star.
    # Both faces follow the same mild cloth wave, without coplanar duplicate faces.
    flaggold=material('forecourt_flag_five_stars',(.99,.77,.015),.75,0)
    def flag_point(gx,gy,side=0):
        t=gx/30
        return (fx+t*1.5,-fy+math.sin(t*math.pi*2.2)*.045+side,7.10-gy/20-t*.07)
    verts=[flag_point(i*30/24,j*20/16) for j in range(17) for i in range(25)]
    faces=[(j*25+i,j*25+i+1,(j+1)*25+i+1,(j+1)*25+i) for j in range(16) for i in range(24)]
    mesh=bpy.data.meshes.new('flag_field');mesh.from_pydata(verts,[],faces);mesh.materials.append(flagmat)
    obj=bpy.data.objects.new('District_Forecourt_flag_field',mesh);bpy.context.collection.objects.link(obj)
    for index,(gx,gy,radius) in enumerate([(5,5,3),(10,2,1),(12,4,1),(12,7,1),(10,9,1)]):
        angle=-math.pi/2 if index==0 else math.atan2(5-gy,5-gx)
        for side in [-.004,.004]:
            points=[flag_point(gx,gy,side)]
            for i in range(10):
                r=radius*(1 if i%2==0 else .381966)
                points.append(flag_point(gx+r*math.cos(angle+i*math.pi/5),gy+r*math.sin(angle+i*math.pi/5),side))
            faces=[(0,i+1,(i+1)%10+1) for i in range(10)]
            mesh=bpy.data.meshes.new('five_point_star');mesh.from_pydata(points,[],faces);mesh.materials.append(flaggold)
            obj=bpy.data.objects.new('District_Forecourt_flag_star_'+str(index),mesh);bpy.context.collection.objects.link(obj)
    # Pano bjdzx90 confirms a round red flowerbed, slender pavilion/column cluster,
    # central drinking-water sculpture and four low standing stone slabs.
    m=data['roundMonument'];x,y=m['x']/U,m['y']/U;r=m['radius']/U
    cylinder('monument_steps',x,y,.06,r,.12,stone)
    ring('monument_outer_ring',x,y,.13,r*.94,r*.78,ctx['trim'])
    cylinder('monument_flowerbed',x,y,.14,r*.77,.12,flowers)
    cylinder('monument_center_plinth',x,y,.22,.43,.30,stone,12)
    for a in [0,math.pi/2,math.pi,math.pi*1.5]:
        px,py=x+.35*math.cos(a),y+.35*math.sin(a)
        cylinder('monument_column',px,py,1.0,.07,1.5,stone,10)
    cylinder('monument_cap',x,y,1.78,.57,.13,stone,16)
    bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,major_radius=.36,minor_radius=.045,
                                   location=(x,-y,2.13),rotation=(math.pi/2,0,0))
    obj=bpy.context.object;obj.name='District_Forecourt_monument_crown';obj.data.materials.append(dark)
    for side in [-1,1]:
        for dy in [-.5,.5]:
            b('monument_slab',x+side*(r+.25),y+dy,.38,.13,.48,.76,stone)
    island=data['trafficIsland']
    ground('District_Forecourt_island_stone',island,stone,.05)
    inset={k:island[k] for k in ['x','y','width','height']}
    inset.update(x=island['x']+3,y=island['y']+3,width=island['width']-6,height=island['height']-6)
    ground('District_Forecourt_island_lawn',inset,lawnmat,.065)
    s=island['sculpture'];sx,sy=s['x']/U,s['y']/U
    b('sculpture_pedestal',sx,sy,.32,.30,.30,.64,ctx['beige'])
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.30,location=(sx,-sy,1.20))
    obj=bpy.context.object;obj.name='District_Forecourt_sculpture';obj.scale=(.48,.48,2.2);obj.data.materials.append(dark)
    plaza=data['plaza']
    polygon('District_Forecourt_plaza_border',plaza['polygon'],brick,.044)
    cx=sum(p['x'] for p in plaza['polygon'])/4;cy=sum(p['y'] for p in plaza['polygon'])/4
    innerpoly=[dict(x=cx+(p['x']-cx)*.92,y=cy+(p['y']-cy)*.94) for p in plaza['polygon']]
    polygon('District_Forecourt_plaza_sand',innerpoly,paving,.058)
    # Shallow paver joints, no raised curbs across routes between the rows.
    for i in range(1,7):
        t=i/7
        a=dict(x=innerpoly[0]['x']+(innerpoly[1]['x']-innerpoly[0]['x'])*t,y=innerpoly[0]['y'])
        c=dict(x=innerpoly[3]['x']+(innerpoly[2]['x']-innerpoly[3]['x'])*t,y=innerpoly[3]['y'])
        road_segment('District_Forecourt_plaza_joint',a,c,.9,stone,.066)
    park=data['parking']
    ground('District_Forecourt_parking',park,ctx['asphalt'],.04)
    for i in range(11):
        x=park['x']+park['width']*i/10
        road_segment('District_Forecourt_parking_line',dict(x=x,y=park['y']),
                     dict(x=x,y=park['y']+park['height']),1.1,trim,.054)
    for side in [-1,1]:
        x=plaza['x']+plaza['width']*(.07 if side<0 else .93)
        for ty in [.18,.8]:
            y=plaza['y']+plaza['height']*ty
            b('bench_seat',x/U,y/U,.35,.85,.25,.08,ctx['trunkmat'])
            for offset in [-.30,.30]: b('bench_leg',x/U+offset,y/U,.17,.08,.16,.34,dark)
