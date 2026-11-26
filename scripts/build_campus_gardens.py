"""Seventh teaching building, Fanghua Garden, Mao statue and Century Clock.

Rebuilt from the user's official-map views. No floating labels or photo planes.
"""
import math
import runpy
from mathutils import Vector
import bmesh


def build_teaching7(ctx, building):
    helpers=runpy.run_path(str(ctx['ROOT']/'scripts/build_campus_landmarks.py'))['helpers']
    b,mesh,cylinder,panel=helpers(ctx,'District_Teaching7_')
    U=ctx['U'];q=building['blocks'][0];mat=ctx['material']
    x,y=(q['x']+q['width']/2)/U,(q['y']+q['height']/2)/U
    w,d,h=q['width']/U,q['height']/U,q['elevation']
    red=mat('teaching7_red_brick',(.51,.15,.105));white=mat('teaching7_white_stone',(.78,.80,.78))
    grey=mat('teaching7_paving',(.53,.58,.57));glass=mat('teaching7_windows',(.095,.20,.27),.40,.15)
    frame=mat('teaching7_frames',(.61,.67,.68),.6,.15)
    b('main_mass',x,y,h/2,w,d,h,red)
    b('white_ground_floor',x,y,.62,w+.02,d+.02,1.24,white)
    b('flat_roof',x,y,h+.08,w+.12,d+.12,.14,grey)
    for side in [-1,1]:
        b('long_parapet',x,y+side*d/2,h+.24,w+.17,.075,.34,white)
        b('end_parapet',x+side*w/2,y,h+.24,.075,d,.34,white)
    bays=24;step=w/bays
    # Pale central stair block interrupts the red wings and rises above the roof.
    b('central_stair',x,y,.5*h,w*.15,d+.10,h+.16,white)
    b('stair_roof',x,y,h+.22,w*.16,d+.17,.14,grey)
    for side in [-1,1]:
        face=y+side*(d/2+.026)
        for i in range(bays):
            xx=x-w/2+(i+.5)*step
            if abs(xx-x)<w*.075: continue
            for floor in range(4):
                z=.62+floor*1.38
                panel('window',xx,face,z,step*.66,.78,0,glass)
                b('window_divider',xx,face+side*.015,z,.025,.035,.78,frame)
                b('window_transom',xx,face+side*.02,z+.10,step*.66,.035,.026,frame)
                b('window_sill',xx,face+side*.025,z-.43,step*.79,.075,.06,white)
        for i in range(0,bays+1,2):
            b('white_vertical_frame',x-w/2+i*step,face,.5*h,.085,.08,h+.08,white)
        for z in [1.27,2.65,4.03,5.45]:
            b('floor_band',x,face,z,w+.07,.085,.085,white)
        for floor in range(4):
            for dx in [-.42,0,.42]:
                panel('stair_window',x+dx,face+side*.06,.65+floor*1.38,.30,.82,0,glass)
    for side in [-1,1]:
        for floor in range(4):
            for offset in [-.43,.43]:
                panel('end_window',x+side*(w/2+.025),y+offset,.65+floor*1.38,.48,.72,math.pi/2,glass)
    front=y+d/2
    b('recessed_entry',x,front+.09,.72,1.25,.06,1.38,glass)
    for side in [-1,1]: b('entry_pier',x+side*.77,front+.14,.76,.15,.25,1.52,white)
    b('entry_canopy',x,front+.30,1.57,1.82,.72,.14,white)
    for i in range(3): b('entry_steps',x,front+.28+i*.13,.035*(3-i),1.90,.50+i*.18,.07*(3-i),grey)
    # Low tile seams on a flat roof, rather than a ribbed gable.
    for i in range(1,12): b('roof_tile_joint',x-w/2+i*w/12,y,h+.156,.012,d-.12,.004,frame)


def build_gardens(ctx):
    helpers=runpy.run_path(str(ctx['ROOT']/'scripts/build_campus_landmarks.py'))['helpers']
    b,mesh,cylinder,panel=helpers(ctx,'District_Landscape_')
    bpy=ctx['bpy'];U=ctx['U'];mat=ctx['material'];data=ctx['LAYOUT']
    stone=mat('garden_sculpture_stone',(.70,.72,.68));bronze=mat('garden_bronze',(.24,.30,.24),.65,.25)
    grey=mat('garden_grey_paving',(.47,.53,.52));red=mat('garden_red_paving',(.48,.26,.23))
    tan=mat('statue_pedestal_stone',(.48,.40,.32));black=mat('statue_dark_plinth',(.19,.24,.24))
    steel=mat('century_clock_metal',(.54,.62,.65),.38,.55)
    clockstone=mat('century_clock_pillars',(.31,.38,.41));clockface=mat('century_clock_dial',(.80,.82,.73))
    gold=mat('century_clock_rim',(.55,.41,.19),.45,.4)
    def ellipsoid(name,x,y,z,sx,sy,sz,material,subdivision=2):
        bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=subdivision,radius=1)
        vertices=bpy.data.meshes.new(name);bm.to_mesh(vertices);bm.free();vertices.materials.append(material)
        ob=bpy.data.objects.new('District_Landscape_'+name,vertices);bpy.context.collection.objects.link(ob)
        ob.location=(x,-y,z);ob.scale=(sx,sy,sz)
        return ob
    def limb(name,a,c,r,material):
        # Data-only cylinders keep repeated source rebuilds linear in object count.
        a,c=Vector(a),Vector(c);ob=cylinder(name,0,0,0,r,(c-a).length,material,10)
        ob.location=(a+c)/2;ob.rotation_euler=(c-a).to_track_quat('Z','Y').to_euler()
        return ob
    def person(name,x,y,z,scale,material,mao=False):
        def v(xx,yy,zz): return (x+xx*scale,-y-yy*scale,z+zz*scale)
        # Full-length coat with broad shoulders, trouser legs, shoes and a head.
        verts=[v(xx,yy,zz) for zz,ww,dd in [(.55,.27,.15),(1.20,.25,.14),(1.61,.34,.16)]
               for xx,yy in [(-ww,-dd),(ww,-dd),(ww,dd),(-ww,dd)]]
        faces=[(0,3,2,1),(8,9,10,11)]
        faces += [(j*4+i,j*4+(i+1)%4,(j+1)*4+(i+1)%4,(j+1)*4+i) for j in range(2) for i in range(4)]
        mesh(name+'_coat',verts,faces,material)
        for side in [-1,1]:
            limb(name+'_leg',v(side*.13,0,.67),v(side*.14,.015,.11),.09*scale,material)
            b(name+'_shoe',x+side*.14*scale,y+.09*scale,z+.075*scale,.18*scale,.35*scale,.15*scale,material)
        ellipsoid(name+'_head',x,y,z+1.92*scale,.185*scale,.18*scale,.245*scale,material)
        ellipsoid(name+'_hair',x,y-.045*scale,z+2.08*scale,.18*scale,.17*scale,.11*scale,material)
        ellipsoid(name+'_nose',x,y+.18*scale,z+1.94*scale,.046*scale,.053*scale,.045*scale,material,1)
        limb(name+'_neck',v(0,0,1.58),v(0,0,1.77),.095*scale,material)
        limb(name+'_left_upper_arm',v(-.30,0,1.53),v(-.38,.04,1.12),.095*scale,material)
        limb(name+'_left_forearm',v(-.38,.04,1.12),v(-.30,.13,.93),.075*scale,material)
        if mao:
            limb(name+'_raised_upper_arm',v(.30,0,1.53),v(.49,.035,1.69),.10*scale,material)
            limb(name+'_raised_forearm',v(.49,.035,1.69),v(.52,.10,2.08),.075*scale,material)
            ellipsoid(name+'_raised_hand',x+.52*scale,y+.10*scale,z+2.16*scale,.07*scale,.08*scale,.13*scale,material)
            b(name+'_coat_seam',x,y+.154*scale,z+1.12*scale,.015*scale,.012*scale,.94*scale,material)
            for zz in [.83,1.03,1.23,1.43]:
                ellipsoid(name+'_coat_button',x+.026*scale,y+.17*scale,z+zz*scale,.025*scale,.015*scale,.025*scale,material,1)
        else:
            limb(name+'_right_arm',v(.30,0,1.53),v(.29,.03,.98),.085*scale,material)
    def paving(name,r,material,z=.052): ctx['ground']('District_Landscape_'+name,r,material,z)
    def rails(x,y,w,d):
        for axis,length in [(0,w),(1,d)]:
            for side in [-1,1]:
                for i in range(7):
                    xx=x+(i/6-.5)*length if axis==0 else x+side*w/2
                    yy=y+side*d/2 if axis==0 else y+(i/6-.5)*length
                    cylinder('statue_fence_post',xx,yy,.25,.028,.45,tan,8)
                    if i<6:
                        nx=x+((i+1)/6-.5)*length if axis==0 else xx
                        ny=yy if axis==0 else y+((i+1)/6-.5)*length
                        for z in [.20,.35]: limb('statue_fence_rail',(xx,-yy,z),(nx,-ny,z),.014,stone)
    garden=data['seventhGarden'];p=garden['statue'];x,y=p['x']/U,p['y']/U
    paving('mao_square',garden['statuePlaza'],red)
    paving('mao_square_lawn',garden['statueLawn'],ctx['grasslight'],.070)
    b('mao_plinth',x,y,.12,.98,.98,.24,black)
    b('mao_pedestal',x,y,.63,.65,.65,.91,tan)
    person('mao_statue',x,y,1.09,1.27,stone,True)
    rails(x,y,garden['statueLawn']['width']/U,garden['statueLawn']['height']/U)
    # Four masonry legs, four outward-facing clock dials and a metal dome.
    p=garden['clock'];x,y=p['x']/U,p['y']/U;span=1.38
    paving('clock_square',garden['clockPlaza'],grey)
    cylinder('clock_platform',x,y,.08,1.30,.16,ctx['trim'],8)
    for sx in [-1,1]:
        for sy in [-1,1]:
            xx,yy=x+sx*span/2,y+sy*span/2
            b('clock_pillar',xx,yy,1.48,.24,.24,2.8,clockstone)
            b('clock_pillar_cap',xx,yy,2.89,.31,.31,.11,steel)
            for z in [.35+i*.24 for i in range(11)]:
                b('clock_masonry_joint',xx,yy,z,.247,.247,.018,steel)
    # Dome rings follow a smooth cap rather than a solid rectangular roof.
    n=24;verts=[]
    for r,z in [(1.00,2.76),(.93,2.91),(.70,3.20),(.33,3.39),(.03,3.44)]:
        verts += [(x+r*math.cos(i*math.tau/n),-y+r*math.sin(i*math.tau/n),z) for i in range(n)]
    mesh('clock_dome',verts,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(4) for i in range(n)],steel)
    for k in range(4):
        angle=k*math.pi/2;normal=Vector((math.cos(angle),-math.sin(angle),0));tangent=Vector((-math.sin(angle),-math.cos(angle),0))
        center=Vector((x,-y,2.83))+normal*.97
        # Circle/ring planes in each vertical face.
        vertices=[tuple(center+normal*.012)]+[tuple(center+tangent*(.33*math.cos(i*math.tau/48))+Vector((0,0,.33*math.sin(i*math.tau/48)))) for i in range(48)]
        mesh('clock_face',vertices,[(0,i+1,(i+1)%48+1) for i in range(48)],clockface)
        for i in range(48):
            a=i*math.tau/48;c=(i+1)*math.tau/48
            limb('clock_rim',center+tangent*.35*math.cos(a)+Vector((0,0,.35*math.sin(a))),
                 center+tangent*.35*math.cos(c)+Vector((0,0,.35*math.sin(c))),.019,gold)
        for i in range(12):
            a=i*math.tau/12
            limb('clock_tick',center+normal*.024+tangent*.25*math.cos(a)+Vector((0,0,.25*math.sin(a))),
                 center+normal*.024+tangent*.29*math.cos(a)+Vector((0,0,.29*math.sin(a))),.008,clockstone)
        limb('clock_hand',center+normal*.03,center+normal*.03+tangent*.15+Vector((0,0,.07)),.014,clockstone)
        limb('clock_hand',center+normal*.03,center+normal*.03+tangent*-.08+Vector((0,0,.22)),.010,clockstone)
    cylinder('clock_finial',x,y,3.58,.055,.27,steel,10)
    # Fanghua Garden: one connected lawn and curved footpaths, no asphalt within.
    f=data['fanghua'];ctx['polygon']('District_Landscape_fanghua_lawn',f['boundary'],ctx['grasslight'],.043)
    for pad in f['entrances']: paving('fanghua_entrance',pad,grey,.061)
    for point in f['rocks']:
        xx,yy=point['x']/U,point['y']/U
        ellipsoid('fanghua_standing_rock',xx,yy,.42,.22,.16,.44,tan,1)
    p=f['statue'];xx,yy=p['x']/U,p['y']/U
    b('fanghua_statue_base',xx,yy,.38,.42,.42,.76,stone)
    person('fanghua_statue',xx,yy,.76,.76,bronze)
    # Seat alcoves, low shrubs and flower beds follow the elliptical park walk.
    for i in range(10):
        a=(i+.2)*math.tau/10
        xx=(842+1.55*(1213+184*math.cos(a)))/U;yy=(946+1.55*(366+168*math.sin(a)))/U
        b('fanghua_bench',xx,yy,.34,.64,.22,.09,ctx['trunkmat'])
        for side in [-1,1]: b('fanghua_bench_leg',xx+side*.23,yy,.16,.06,.14,.32,grey)
        ellipsoid('fanghua_shrub',xx+.40,yy,.30,.28,.32,.30,ctx['leaves'][0],1)
    # Courtyard planting is open enough to keep the entrance/statue/clock axis clear.
    for u,v in [(430,310),(495,400),(780,310),(855,430),(470,515),(835,520),
                (1065,220),(1130,220),(1275,210),(1380,290),(1380,430),(1250,515),(1080,465)]:
        xx,yy=(842+u*1.55)/U,(946+v*1.55)/U
        for j in [-1,0,1]: ellipsoid('garden_low_shrub',xx+j*.25,yy,.23,.30,.33,.25,ctx['leaves'][0],1)
