"""Photo/map-based Tianyou Hall, library, Ming Lake and basketball courts.

Coordinates remain the district's shared logical footprint; Blender uses Z up.
Called both by the full district build and the selective refinement command.
"""
import math
import bmesh


def helpers(ctx, prefix):
    bpy=ctx['bpy'];box=ctx['box']
    def mesh(name,verts,faces,mat):
        data=bpy.data.meshes.new(prefix+name);data.from_pydata(verts,[],faces)
        data.materials.append(mat);data.update()
        obj=bpy.data.objects.new(prefix+name,data);bpy.context.collection.objects.link(obj)
        return obj
    def b(name,*args): return box(prefix+name,*args)
    def cylinder(name,x,y,z,r,d,mat,n=8):
        data=bpy.data.meshes.new(prefix+name);bm=bmesh.new()
        bmesh.ops.create_cone(bm,cap_ends=True,cap_tris=False,segments=n,radius1=r,radius2=r,depth=d)
        bm.to_mesh(data);bm.free();data.materials.append(mat)
        obj=bpy.data.objects.new(prefix+name,data);bpy.context.collection.objects.link(obj);obj.location=(x,-y,z)
        return obj
    def panel(name,x,y,z,w,h,angle,mat):
        # One-sided facade surface; no unseen window-box caps to export.
        tx,ty=math.cos(angle),math.sin(angle)
        return mesh(name,[(x+tx*s*w/2,-y-ty*s*w/2,z+t*h/2)
                         for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]],[(0,1,2,3)],mat)
    return b,mesh,cylinder,panel


def build_tianyou(ctx, building):
    before=set(ctx['bpy'].context.scene.objects)
    b,mesh,cylinder,panel=helpers(ctx,'District_TianyouHall_')
    mat=ctx['material'];U=ctx['U'];q=building['blocks'][0]
    x,y=(q['x']+q['width']/2)/U,(q['y']+q['height']/2)/U
    east_front=building.get('front')=='east'
    w,d,h=q['width']/U,q['height']/U,q['elevation']
    if east_front: w,d=d,w
    front=y+d/2
    stone=mat('tianyou_grey_tile',(.53,.57,.58))
    silver=mat('tianyou_aluminium',(.49,.58,.63),.45,.35)
    glass=mat('tianyou_blue_glass',(.035,.13,.24),.25,.32)
    dark=mat('tianyou_soffit',(.15,.22,.28))
    # The photograph's entry is recessed below the full-width cantilever.
    b('auditorium',x,y-.38,h/2,w,d-.76,h,stone)
    b('roof_parapet',x,y-.4,h+.08,w+.10,d-.65,.18,silver)
    b('stage_roof',x,y-.65,h+.62,w*.74,d*.64,1.03,stone)
    b('stage_cap',x,y-.65,h+1.18,w*.77,d*.67,.14,silver)
    for side in [-1,1]:
        b('solid_shoulder',x+side*w*.43,front-.34,3.9,w*.14,.67,7.4,stone)
        # Narrow vertical service windows on the side shoulders.
        for z in ([4.8,6.0] if side==1 else [1.0,2.25,3.5,4.75,6.0]):
            panel('shoulder_window',x+side*w*.43,front+.005,z,.24,.85,0,glass)
    entry_y=front-.20
    panel('entry_curtain',x,entry_y,2.13,w*.72,4.02,0,glass)
    for i in range(13):
        xx=x-w*.36+i*w*.72/12
        b('curtain_mullion',xx,entry_y+.025,2.13,.035,.055,4.02,silver)
    for z in [.36,1.30,2.40,3.45,4.15]:
        b('curtain_transom',x,entry_y+.029,z,w*.72,.06,.035,silver)
    # Six pairs of glazed doors with silver frames and handles.
    for i in range(6):
        xx=x+(i-2.5)*w*.112
        b('door_header',xx,entry_y+.045,1.56,w*.095,.08,.055,silver)
        for side in [-1,1]:
            b('door_jamb',xx+side*w*.0475,entry_y+.045,.86,.04,.08,1.40,silver)
            b('door_handle',xx+side*.08,entry_y+.10,.85,.02,.035,.24,silver)
    b('deep_canopy_soffit',x,front+.02,4.40,w*1.025,1.27,.29,dark)
    b('deep_canopy_edge',x,front+.64,4.57,w*1.03,.08,.17,silver)
    for i in range(5):
        xx=x-w*.35+i*w*.175
        b('entry_column',xx,front+.41,2.18,.16,.20,4.22,silver)
    panel('upper_glazed_band',x,front-.16,5.94,w*.73,2.35,0,glass)
    # Tall vertical blades, rooftop horizontal solar shades and balcony railing.
    for i in range(17):
        xx=x-w*.365+i*w*.73/16
        b('upper_blade',xx,front+.005,5.98,.065,.30,2.55,silver)
    for j in range(7):
        b('solar_shade',x,front-.26+j*.15,7.18+j*.018,w*.79,.065,.055,silver)
    for z in [4.84,5.28]: b('balcony_rail',x,front+.12,z,w*.78,.035,.035,silver)
    for i in range(25): b('balcony_baluster',x+(i/24-.5)*w*.78,front+.12,5.05,.022,.025,.46,silver)
    # Side elevations are a quiet tiled volume with discrete window bays.
    for side in [-1,1]:
        for j in range(7):
            yy=y-d/2+.45+j*(d-1.5)/6
            for z in [1.8,4.9]: panel('side_window',x+side*(w/2+.006),yy,z,.48,1.5,math.pi/2,glass)
        for z in [2.9,5.8]: b('tile_joint',x+side*(w/2+.013),y-.35,z,.018,d-.74,.018,silver)
    for i in range(5):
        b('entry_step',x,front+.12+(4-i)*.10,.04+i*.045,w*.81,.20+(4-i)*.18,.08+i*.09,ctx['base'])
    for i,char in enumerate('天佑会堂'):
        ctx['text']('District_TianyouHall_vertical_name_'+str(i),char,
                    x+w*.43,front+.025,3.62-i*.64,.44,ctx['gold'])
    if east_front:
        from mathutils import Matrix
        transform=Matrix.Translation((x,-y,0)) @ Matrix.Rotation(math.pi/2,4,'Z') @ Matrix.Translation((-x,y,0))
        for obj in set(ctx['bpy'].context.scene.objects)-before:
            if obj.type=='MESH':
                obj.data.transform(transform @ obj.matrix_basis)
                obj.matrix_basis=Matrix.Identity(4)


def build_library(ctx, building):
    b,mesh,cylinder,panel=helpers(ctx,'District_Library_')
    mat=ctx['material'];U=ctx['U'];q=building['blocks'][0]
    x,y=(q['x']+q['width']/2)/U,(q['y']+q['height']/2)/U
    w,d=q['width']/U,q['height']/U
    wall=mat('library_ivory',(.74,.76,.75));roof=mat('library_flat_roof',(.56,.61,.61))
    red=mat('library_red_tiles',(.57,.12,.075));glass=mat('library_blue_atrium',(.025,.20,.42),.24,.35)
    windows=mat('library_reading_glass',(.10,.22,.29),.34,.2)
    frame=mat('library_frames',(.55,.62,.64),.5,.2);base=ctx['base']
    def octagon(cx,cy,ww,dd):
        cut=min(ww,dd)*.23
        return [(cx-ww/2+cut,cy-dd/2),(cx+ww/2-cut,cy-dd/2),
                (cx+ww/2,cy-dd/2+cut),(cx+ww/2,cy+dd/2-cut),
                (cx+ww/2-cut,cy+dd/2),(cx-ww/2+cut,cy+dd/2),
                (cx-ww/2,cy+dd/2-cut),(cx-ww/2,cy-dd/2+cut)]
    def prism(name,points,z0,z1,material):
        n=len(points);verts=[(xx,-yy,z) for z in [z0,z1] for xx,yy in points]
        faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        # Ground polygon is clockwise when viewed from Blender's top.
        return mesh(name,verts,faces,material)
    def roof_pyramid(name,cx,cy,z,ww,dd,lift):
        points=octagon(cx,cy,ww,dd);verts=[(xx,-yy,z) for xx,yy in points]+[(cx,-cy,z+lift)]
        mesh(name,verts,[(i,8,(i+1)%8) for i in range(8)],red)
        # Sparse visible hip ribs keep the low-poly silhouette readable.
        for xx,yy in points:
            ctx['beam']('District_Library_roof_ridge',(xx,-yy,z+.025),(cx,-cy,z+lift+.025),.024,frame)
    # A tall centre behind two lower front reading rooms; the rear pair is higher.
    b('central_mass',x,y-d*.15,6.8,w*.36,d*.53,13.6,wall)
    roof_pyramid('central_red_roof',x,y-d*.15,13.66,w*.40,d*.57,2.7)
    for side in [-1,1]:
        b('stair_tower',x+side*w*.21,y-d*.17,6.15,w*.115,d*.35,12.3,wall)
        roof_pyramid('stair_red_roof',x+side*w*.21,y-d*.17,12.35,w*.14,d*.39,1.2)
        for floor in range(6):
            panel('tower_slit',x+side*w*.21,y+d*.007,1.25+floor*1.8,.24,.64,0,windows)
    for sx,sy in [(-1,-1),(1,-1),(-1,1),(1,1)]:
        cx=x+sx*w*.285;cy=y+sy*d*.255
        ww,dd=w*.395,d*.405;h=10.0 if sy<0 else 7.1;floors=5 if sy<0 else 3
        points=octagon(cx,cy,ww,dd)
        prism('reading_wing',points,0,h,wall)
        prism('wing_base',points,0,.55,base)
        edge=[(cx+(xx-cx)*1.015,cy+(yy-cy)*1.015) for xx,yy in points]
        prism('red_roof_fascia',edge,h-.04,h+.19,red)
        prism('pale_roof_parapet',edge,h+.19,h+.28,wall)
        inner=[(cx+(xx-cx)*.96,cy+(yy-cy)*.96) for xx,yy in points]
        prism('flat_roof',inner,h+.28,h+.30,roof)
        for a,c in zip(points,points[1:]+points[:1]):
            dx,dy=c[0]-a[0],c[1]-a[1];length=math.hypot(dx,dy);angle=math.atan2(dy,dx)
            nx,ny=dy/length,-dx/length
            for floor in range(floors):
                z=1.15+floor*(h-1.35)/floors
                mx,my=(a[0]+c[0])/2+nx*.012,(a[1]+c[1])/2+ny*.012
                panel('reading_window_band',mx,my,z+.40,length*.88,.92,angle,windows)
                for k in range(1,5):
                    t=k/5;xx=a[0]+dx*t+nx*.024;yy=a[1]+dy*t+ny*.024
                    ob=b('window_mullion',xx,yy,z+.4,.035,.038,.94,frame);ob.rotation_euler.z=-angle
                ob=b('window_sill',mx,my,z-.10,length,.09,.07,wall);ob.rotation_euler.z=-angle
    # Three connected blue planes create the faceted central curtain wall.
    front=y+d*.118
    path=[(x-w*.115,front-.18),(x-w*.08,front+.10),(x+w*.08,front+.10),(x+w*.115,front-.18)]
    for a,c in zip(path,path[1:]):
        dx,dy=c[0]-a[0],c[1]-a[1];length=math.hypot(dx,dy);angle=math.atan2(dy,dx)
        panel('atrium_glass', (a[0]+c[0])/2,(a[1]+c[1])/2,7.25,length,11.90,angle,glass)
        for z in [1.6+i*.73 for i in range(17)]:
            ob=b('atrium_transom',(a[0]+c[0])/2,(a[1]+c[1])/2+.025,z,length,.035,.025,frame);ob.rotation_euler.z=-angle
        for i in range(5):
            xx=a[0]+dx*i/4;yy=a[1]+dy*i/4
            b('atrium_mullion',xx,yy+.03,7.25,.03,.04,11.9,frame)
    entry=y+d*.43
    b('entry_glass',x,entry-.24,1.35,w*.27,.06,2.35,windows)
    for side in [-1,1]: b('entry_pier',x+side*w*.145,entry-.10,1.4,.34,.66,2.8,wall)
    # Chamfered porch rather than an isolated thin canopy.
    porch=octagon(x,entry,w*.34,d*.15)
    prism('entry_portal',porch,2.45,3.45,wall)
    for i in range(7):
        b('entrance_steps',x,y+d*.49+(6-i)*.13,.035+i*.045,w*.32,.32+(6-i)*.26,.07+i*.09,ctx['trim'])
    for side in [-1,1]:
        b('step_cheek',x+side*w*.17,y+d*.51,.35,.15,1.35,.55,wall)


def build_ming_lake(ctx):
    b,mesh,cylinder,panel=helpers(ctx,'District_Water_')
    U=ctx['U'];mat=ctx['material'];lake=ctx['LAYOUT']['lake'];detail=ctx['LAYOUT']['lakeDetails']
    water=mat('district_lake',(.035,.24,.34),.33,.18)
    bank=mat('lake_stone_bank',(.46,.53,.51));paving=mat('lake_shore_paving',(.68,.70,.65))
    dark=mat('lake_submerged_edge',(.14,.32,.34));white=ctx['trim']
    points=[(p['x']/U,p['y']/U) for p in lake];n=len(points)
    ctx['polygon']('District_Water_surface',lake,water,.025)
    def offset_outline(amount):
        out=[]
        for i,p in enumerate(points):
            before=points[i-1];after=points[(i+1)%n]
            dx,dy=after[0]-before[0],after[1]-before[1];length=math.hypot(dx,dy)
            out.append((p[0]+dy/length*amount,p[1]-dx/length*amount))
        return out
    def strip(name,inner,outer,z,material):
        verts=[(xx,-yy,z) for poly in [inner,outer] for xx,yy in poly]
        mesh(name,verts,[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)],material)
    strip('shallow_edge',points,offset_outline(-.18),.030,dark)
    strip('stone_coping',points,offset_outline(.15),.125,bank)
    strip('shore_walkway',offset_outline(.15),offset_outline(.57),.115,paving)
    strip('outer_grass_trim',offset_outline(.57),offset_outline(.67),.120,ctx['grasslight'])
    verts=[(xx,-yy,z) for z in [.026,.125] for xx,yy in points]
    mesh('retaining_wall',verts,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],bank)
    # Pale crescent inside the north-west shore, with shallow water behind it.
    controls=detail['crescent'];crescent=[]
    for i in range(len(controls)-1):
        p0,p1,p2,p3=controls[max(0,i-1)],controls[i],controls[i+1],controls[min(len(controls)-1,i+2)]
        for j in range(8):
            t=j/8
            crescent.append({axis:.5*((2*p1[axis])+(-p0[axis]+p2[axis])*t+
                (2*p0[axis]-5*p1[axis]+4*p2[axis]-p3[axis])*t*t+
                (-p0[axis]+3*p1[axis]-3*p2[axis]+p3[axis])*t*t*t) for axis in ['x','y']})
    crescent.append(controls[-1])
    cx=sum(p['x'] for p in crescent)/len(crescent);cy=sum(p['y'] for p in crescent)/len(crescent)
    shallow=[dict(x=cx+(p['x']-cx)*.99,y=cy+(p['y']-cy)*.99) for p in crescent]
    ctx['polygon']('District_Water_shallow_pool',shallow,mat('lake_shallow_water',(.085,.29,.32)),.035)
    for a,c in zip(crescent,crescent[1:]): ctx['road_segment']('District_Water_crescent_edge',a,c,3.1,paving,.065)
    for stair in detail['steps']:
        for i in range(5):
            b('bank_steps',stair['x']/U,(stair['y']+i*stair['depth']/5)/U,.145-i*.025,
              stair['width']/U,stair['depth']/U/5,.035,paving)
            b('bank_step_joint',stair['x']/U,(stair['y']+(i+.48)*stair['depth']/5)/U,.165-i*.025,
              stair['width']/U,.012,.006,bank)
    # Pavilion is close to the west bank, not stranded in the centre of the lake.
    p=detail['pavilion'];x,y=p['x']/U,p['y']/U;r=p['radius']/U
    red=mat('lake_pavilion_red',(.40,.09,.055));gold=mat('lake_pavilion_roof_gold',(.79,.43,.035))
    green=mat('lake_pavilion_green_trim',(.10,.30,.20));roofdark=mat('lake_pavilion_roof_shadow',(.40,.19,.025))
    for z,radius,depth in [(.10,r*1.18,.20),(.23,r*1.07,.12),(.32,r,.08)]:
        cylinder('pavilion_stone_platform',x,y,z,radius,depth,paving,6)
    for i in range(6):
        angle=i*math.pi/3;xx,yy=x+math.cos(angle)*r*.67,y+math.sin(angle)*r*.67
        cylinder('pavilion_column',xx,yy,1.02,.055,1.4,red,8)
        if i not in [2,3]:
            next_angle=(i+1)*math.pi/3
            a=(xx,-yy,.69);c=(x+math.cos(next_angle)*r*.67,-y-math.sin(next_angle)*r*.67,.69)
            ctx['beam']('District_Water_pavilion_railing',a,c,.04,red)
    # Concave profiles and upturned tips, two stacked hexagonal roofs.
    def roof(name,z,radius,height):
        rings=[(radius,z+.10),(radius*.87,z),(radius*.48,z+height*.55),(radius*.10,z+height)]
        verts=[(x+rr*math.cos(i*math.pi/3),-y-rr*math.sin(i*math.pi/3),zz) for rr,zz in rings for i in range(6)]
        faces=[(k*6+i,k*6+(i+1)%6,(k+1)*6+(i+1)%6,(k+1)*6+i) for k in range(3) for i in range(6)]
        mesh(name,verts,[tuple(reversed(f)) for f in faces],gold)
        for i in range(6):
            a=i*math.pi/3;c=(i+1)*math.pi/3
            ctx['beam']('District_Water_roof_eave',(x+radius*math.cos(a),-y-radius*math.sin(a),z+.1),
                        (x+radius*math.cos(c),-y-radius*math.sin(c),z+.1),.035,green)
        cylinder('pavilion_underroof',x,y,z-.04,radius*.82,.09,roofdark,6)
    roof('pavilion_lower_roof',1.74,r*.99,.73)
    roof('pavilion_upper_roof',2.34,r*.64,.65)
    cylinder('pavilion_finial',x,y,3.04,.055,.20,gold,8)
    for a,c in zip(detail['boardwalk'],detail['boardwalk'][1:]):
        ctx['road_segment']('District_Water_pavilion_approach',a,c,18,paving,.14)
    # A few restrained ripple strokes; no expensive planar reflections/post effects.
    ripples=mat('lake_ripple',(.09,.30,.39),.48,.08)
    for j in range(15):
        xx=(ctx['LAYOUT']['lake'][0]['x']/U)+.8+(j*1.31)%7.0
        yy=min(p['y'] for p in lake)/U+1.6+(j*.83)%10.5
        logical=dict(x=xx*U,y=yy*U)
        # Only draw short marks well inside the polygon; never across the bank.
        inside=False
        for i,a in enumerate(lake):
            c=lake[i-1]
            if (a['y']>logical['y'])!=(c['y']>logical['y']) and logical['x']<(c['x']-a['x'])*(logical['y']-a['y'])/(c['y']-a['y'])+a['x']: inside=not inside
        if inside: b('ripple',xx,yy,.039,.14+(j%3)*.09,.014,.002,ripples)


def build_basketball(ctx):
    b,mesh,cylinder,panel=helpers(ctx,'District_Sports_');U=ctx['U']
    white=ctx['trim'];blue=ctx['courtmat'];keymat=ctx['material']('court_key_blue',(.07,.24,.34))
    def line(a,c): ctx['road_segment']('District_Sports_line',dict(x=a[0]*U,y=a[1]*U),dict(x=c[0]*U,y=c[1]*U),.65,white,.054)
    def arc(cx,cy,r,start,end,segments=24):
        pts=[(cx+r*math.cos(start+(end-start)*i/segments),cy+r*math.sin(start+(end-start)*i/segments)) for i in range(segments+1)]
        for a,c in zip(pts,pts[1:]): line(a,c)
    for q in ctx['LAYOUT']['courts']:
        ctx['ground']('District_Sports_base',q,blue,.025)
        x,y,w,d=q['x']/U,q['y']/U,q['width']/U,q['height']/U;cx=x+w/2
        for xx in [x+.055,x+w-.055]: line((xx,y+.055),(xx,y+d-.055))
        for yy in [y+.055,y+d/2,y+d-.055]: line((x+.055,yy),(x+w-.055,yy))
        arc(cx,y+d/2,w*.13,0,math.tau)
        for side in [-1,1]:
            end=y+.055 if side<0 else y+d-.055;sign=-side
            key_end=end+sign*d*.205;keyw=w*.32
            b('painted_key',cx,(end+key_end)/2,.043,keyw,abs(key_end-end),.008,keymat)
            for xx in [cx-keyw/2,cx+keyw/2]: line((xx,end),(xx,key_end))
            line((cx-keyw/2,key_end),(cx+keyw/2,key_end))
            arc(cx,key_end,keyw/2,0,math.pi if side<0 else -math.pi)
            hoop=end+sign*.48
            b('post',cx,end+sign*.23,1.08,.065,.065,2.16,ctx['metal'])
            b('support_arm',cx,end+sign*.34,2.0,.055,.30,.055,ctx['metal'])
            b('backboard',cx,hoop,2.05,.75,.055,.48,white)
            verts=[(cx+r*math.cos(i*math.tau/16),-hoop-sign*.14-r*math.sin(i*math.tau/16),1.96)
                   for r in [.13,.105] for i in range(16)]
            mesh('rim',verts,[(i,(i+1)%16,(i+1)%16+16,i+16) for i in range(16)],ctx['material']('court_rim_red',(.60,.12,.025)))
            # Three-point arcs open towards the centre of each court.
            arc(cx,hoop,w*.38,0,math.pi if side<0 else -math.pi,32)
