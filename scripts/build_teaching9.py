"""Reference-based Teaching 9 authoring shared by full and focused exports."""
import math

def optimize_window_panel(obj):
    """Two-sided glazing/detail planes need no hidden solid-box end caps."""
    if obj.type!='MESH' or not obj.name.startswith('District_Teaching9_'): return
    name=obj.name.split('.')[0]
    if not any(name.endswith(s) for s in ['_glass','_recess','_transom','_ac_grille']): return
    if len(obj.data.vertices)!=8 or len(obj.data.polygons)!=6: return
    verts=[tuple(v.co) for v in obj.data.vertices]
    w=max(v[0] for v in verts)-min(v[0] for v in verts)
    d=max(v[1] for v in verts)-min(v[1] for v in verts)
    faces=[(0,1,5,4),(2,3,7,6)] if d<w else [(1,2,6,5),(3,0,4,7)]
    obj.data.clear_geometry();obj.data.from_pydata(verts,[],faces)

def build_teaching9(ctx, building):
    box=ctx['box']; material=ctx['material']; bpy=ctx['bpy']; U=ctx['U']
    prefix='District_Teaching9_'
    tile=material('teaching9_pale_tile',(.76,.74,.66))
    recess=material('teaching9_window_recess',(.15,.20,.22))
    glass=material('teaching9_blue_glass',(.075,.25,.33),.32,.16)
    frame=material('teaching9_aluminium',(.46,.51,.48),.5,.3)
    stone=material('teaching9_portal_stone',(.40,.30,.24))
    roof=material('teaching9_roof_concrete',(.51,.54,.51))
    dark=material('teaching9_relief_band',(.18,.17,.15))
    trim=material('teaching9_light_trim',(.86,.83,.74))
    paving=material('teaching9_courtyard_paving',(.44,.33,.26))
    green=material('teaching9_hedge',(.19,.31,.12))
    def b(name,x,y,z,w,d,h,mat):
        obj=box(prefix+name,x,y,z,w,d,h,mat)
        optimize_window_panel(obj)
        return obj
    def window(name,x,y,z,w,h,axis='x',side=1,ac=False):
        # Real recess border, multiple glazed panes and shallow projecting sill.
        def face(suffix,z0,width,height,depth,offset,mat):
            return b(name+suffix,x if axis=='x' else x+side*offset,
                     y+side*offset if axis=='x' else y,z0,
                     width if axis=='x' else depth,depth if axis=='x' else width,height,mat)
        face('_recess',z,w+.11,h+.09,.045,.018,recess)
        face('_glass',z,w,h,.025,.05,glass)
        panes=max(2,round(w/.33))
        for i in range(panes+1):
            offset=-w/2+i*w/panes
            if axis=='x': b(name+'_mullion',x+offset,y+side*.074,z,.018,.025,h,frame)
            else: b(name+'_mullion',x+side*.074,y+offset,z,.025,.018,h,frame)
        face('_transom',z+h*.22,w,.018,.025,.077,frame)
        face('_sill',z-h/2-.045,w+.14,.055,.18,.08,trim)
        if ac:
            ax,ay=x+w*.36,y+side*.22
            if axis!='x': ax,ay=x+side*.22,y+w*.36
            b(name+'_ac',ax,ay,z-h*.62,.30 if axis=='x' else .23,
              .23 if axis=='x' else .30,.21,trim)
            for j in range(3):
                if axis=='x': b(name+'_ac_grille',ax,ay+side*.124,z-h*.62-.05+j*.05,.23,.018,.014,frame)
                else: b(name+'_ac_grille',ax+side*.124,ay,z-h*.62-.05+j*.05,.018,.23,.014,frame)

    for part in building['blocks']:
        role=part['role']; x=(part['x']+part['width']/2)/U; y=(part['y']+part['height']/2)/U
        w,d,h=part['width']/U,part['height']/U,part['elevation']; bottom=part.get('bottom',0)
        b(role+'_mass',x,y,(h+bottom)/2,w,d,h-bottom,tile)
        # Flat parapets and setback rooftop volumes replace the previous pitched portal.
        b(role+'_roof',x,y,h+.05,w-.13,d-.13,.11,roof)
        for sx in [-1,1]: b(role+'_parapet',x+sx*(w/2-.035),y,h+.16,.07,d,.28,trim)
        for sy in [-1,1]: b(role+'_parapet',x,y+sy*(d/2-.035),h+.16,w,.07,.28,trim)
        if role=='front-center': continue
        pitch=1.32
        for axis,length in [('x',w),('y',d)]:
            # Side passage facade uses the grouped horizontal windows from photo 3.
            group=1.52 if role.startswith('west') and axis=='y' else .95
            cols=max(1,int((length-.3)/group))
            for side in [-1,1]:
                for col in range(cols):
                    offset=-length/2+(col+.5)*length/cols
                    for floor in range(part['floors']):
                        z=.72+floor*pitch
                        if z-.45<bottom or z+.45>h-.2: continue
                        wx,wy=(x+offset,y+side*d/2) if axis=='x' else (x+side*w/2,y+offset)
                        window(role,wx,wy,z,length/cols*.70,.68,axis,side,ac=(floor>0 and (floor+col)%3==0 and role!='crossbar'))
                # Discrete facade piers, plus a shallow plinth at ground level.
                if bottom==0:
                    if axis=='x': b(role+'_plinth',x,y+side*(d/2+.025),.17,w,.055,.34,roof)
                    else: b(role+'_plinth',x+side*(w/2+.025),y,.17,.055,d,.34,roof)
        if role in ['rear','front-west','front-east']:
            for col in range(5):
                sx=x-w/2+.18+col*(w-.36)/4
                b(role+'_vertical_rib',sx,y+d/2+.035,h/2,.055,.07,h-.1,trim)

    front=next(p for p in building['blocks'] if p['role']=='front-center')
    cx=(front['x']+front['width']/2)/U; fy=(front['y']+front['height'])/U
    cw=front['width']/U; fh=front['elevation']
    # Continuous dark blue glass slot, tall stone rectangular portico, no pyramid.
    b('entry_curtain',cx,fy+.03,4.12,cw-.55,.06,7.9,glass)
    for i in range(7): b('entry_mullion',cx-(cw-.55)/2+i*(cw-.55)/6,fy+.08,4.12,.035,.04,7.9,frame)
    for i in range(9): b('entry_transom',cx,fy+.085,.25+i*.98,cw-.55,.04,.035,frame)
    for side in [-1,1]:
        px=cx+side*1.94
        b('entry_portal_post',px,fy+.74,2.77,.48,1.5,5.54,stone)
        b('entry_stone_panel',cx+side*2.14,fy+.04,4.38,.30,.14,8.76,tile)
    b('entry_portal_lintel',cx,fy+.74,5.18,4.36,1.5,.73,stone)
    # Abstract dark relief band: geometric patches, no copied artwork or labels.
    b('entry_relief',cx,fy+1.505,4.65,3.38,.055,.60,dark)
    for i in range(13):
        b('entry_relief_panel',cx-1.56+i*.26,fy+1.54,4.66+(.06 if i%2 else -.03),.19,.025,.29+(i%3)*.07,roof)
    b('entry_door',cx,fy+.19,1.35,2.68,.08,2.55,recess)
    for i in range(5):
        b('entry_door_frame',cx-1.34+i*.67,fy+.24,1.35,.045,.06,2.55,frame)
    b('entry_door_glass',cx,fy+.245,1.35,2.5,.018,2.4,glass)
    for side in [-1,1]: b('entry_door_handle',cx+side*.13,fy+.28,1.12,.025,.04,.38,trim)
    b('entry_header_body',cx,fy-.75,9.2,cw+1.15,1.55,1.5,tile)
    for i in range(7): window('entry_top',cx-2.1+i*.7,fy+.035,9.35,.30,.66)
    for side in [-1,1]: b('entry_upper_frame',cx+side*2.5,fy+.08,7.55,.22,.28,1.7,trim)
    b('entry_upper_beam',cx,fy+.08,8.35,5.2,.28,.22,trim)
    # Broad shallow landing. Geometry is explicit; no misleading tall invisible step.
    for i in range(5):
        b('entry_steps',cx,fy+1.57+i*.14,.065-i*.01,5.0+i*.10,.30,.035,trim)
    for side in [-1,1]:
        b('entry_handrail',cx+side*2.66,fy+1.66,.42,.035,1.30,.035,frame)
        for j in range(3): b('entry_handrail_post',cx+side*2.66,fy+1.13+j*.45,.22,.035,.035,.44,frame)

    passage=next(p for p in building['blocks'] if p['role']=='west-passage')
    wx=passage['x']/U; py=(passage['y']+passage['height']/2)/U; pd=passage['height']/U
    b('side_passage_stone_header',wx-.06,py,2.37,.22,pd+.14,.45,stone)
    for side in [-1,1]: b('side_passage_portal_post',wx-.06,py+side*(pd/2-.09),1.1,.22,.18,2.2,stone)
    b('side_passage_floor',wx+passage['width']/U/2,py,.009,passage['width']/U+.3,pd,.018,roof)
    # Recessed side balconies above the passage, with slender pergola crosspieces.
    for z in [3.2,4.52,5.84]:
        b('side_recess',wx-.025,py,z,.04,1.68,.87,recess)
        b('side_balcony_slab',wx-.24,py,z-.48,.5,1.83,.09,trim)
        for i in range(5): b('side_balcony_rail',wx-.48,py-.75+i*.375,z-.15,.035,.035,.62,frame)
        b('side_balcony_toprail',wx-.48,py,z+.16,.035,1.65,.035,frame)
        for i in range(5): b('side_pergola',wx-.22,py-.75+i*.375,z+.52,.55,.065,.065,trim)

    # Split courtyards and low crossbar are independently visible in the overhead view.
    for i,court in enumerate(building['courtyards']):
        x=(court['x']+court['width']/2)/U; y=(court['y']+court['height']/2)/U
        w,d=court['width']/U,court['height']/U
        b('courtyard_paving',x,y,.012,w,d,.024,paving)
        for side in [-1,1]:
            b('courtyard_plantbed',x+side*(w/2-.32),y,.11,.45,d*.65,.22,roof)
            b('courtyard_hedge',x+side*(w/2-.32),y,.32,.40,d*.65,.25,green)
    rear=building['blocks'][0]
    rx=(rear['x']+rear['width']*.45)/U; ry=(rear['y']+rear['height']/2)/U
    b('rear_roof_setback',rx,ry,10.05,7.8,2.5,1.1,tile)
    b('rear_roof_setback_cap',rx,ry,10.65,7.9,2.6,.12,roof)
    for i in range(9): window('rear_roof_strip',rx-3.3+i*.82,ry+1.27,10.03,.59,.24)
    # Flat square stair cores and open roof frames; the roofline stays orthogonal.
    for corner in [building['blocks'][0], building['blocks'][5], building['blocks'][7]]:
        x=(corner['x']+corner['width']*.12)/U; y=(corner['y']+corner['height']*.4)/U; z=corner['elevation']
        b('stair_head',x,y,z+.65,1.1,1.05,1.3,tile)
        b('stair_head_cap',x,y,z+1.32,1.18,1.13,.1,trim)
    x=(building['x']+18)/U; y=(building['y']+building['height']*.68)/U
    for sy in [-1,1]: b('roof_open_rail',x+.8,y+sy*1.3,9.13,1.8,.075,.12,trim)
    for j in range(5): b('roof_open_beam',x+.8,y-1.3+j*.65,9.13,1.8,.075,.12,trim)
