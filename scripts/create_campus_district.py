"""Author the user's selected campus district in one shared ground coordinate frame.

Reference artwork is oblique: fit the ground, never the roof label positions.
No survey precision is implied. Run with Python + Pillow, then build_siyuan.py --district.
"""
import json
import math
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets-source/campus-3d/district'
REF=SOURCE/'reference'
REF.mkdir(parents=True,exist_ok=True)
for filename,target in [
    ('codex-clipboard-93e7b791-861e-4c85-8975-13b06766fdbb.png','district-user.png'),
    ('codex-clipboard-57836596-8035-4230-a916-e34bd58722a5.png','district-names-user.png'),
    ('codex-clipboard-246e9c24-b566-4a73-8bfa-294b44072198.png','teaching9-map.png'),
    ('codex-clipboard-5c2eccb1-b20a-40ff-a22e-3f805e230371.png','teaching9-front.png'),
    ('codex-clipboard-07726d7a-de55-4e2f-bb9a-0011e90f0a4d.png','teaching9-side.png')]:
    path=Path('C:/Users/74286/AppData/Local/Temp')/filename
    if path.exists(): shutil.copyfile(path,REF/target)
for filename,target in [
    ('codex-clipboard-fec73a20-f11e-4450-8d84-5d81399b933b.png','forecourt-user-site.png')]:
    path=Path('C:/Users/74286/AppData/Local/Temp')/filename
    if path.exists(): shutil.copyfile(path,REF/target)
wechat=Path('D:/xwechat_files/wxid_o05x5idh6q7y22_fc91/temp/RWTemp/2026-11/9e20f478899dc29eb19741386f9343c8')
for filename,target in [('77ce961dc787d45e4eb1b00170828b3e.png','forecourt-user-region.png'),
                        ('ef19c9c994eb1f9cd4a515ca51dd4c79.png','forecourt-user-detail.png')]:
    if (wechat/filename).exists(): shutil.copyfile(wechat/filename,REF/target)
for filename,target in [
    ('144f4e771e4419a618adb2ece5431e2a.png','basketball-overlap.png'),
    ('37ecf55e6e2f448d9dcc2859d80baf6d.png','tianyou-before.png'),
    ('a9f1f583db4c01c82b08465d634ff349.png','tianyou-front.png'),
    ('90c850f7aeede035854a96c6fe5b8752.png','flag-before.png'),
    ('3f02df6ea8b2b9704302327e3112aa29.png','ming-lake-before.png'),
    ('685825c48577c1af070bee98268d51dc.png','ming-lake-map.png'),
    ('ab04051f858c4e9a94c9fe57ff4e5184.png','library-map.png'),
    ('3b0be2f8c4d84c2e85797cbd5ae259b2.png','library-front.png')]:
    if (wechat/filename).exists(): shutil.copyfile(wechat/filename,REF/target)
temp=ROOT/'artifacts/campus-3d/forecourt'
for filename,target in [
    ('006ff2769358834321d08e3597c1d968.png','fanghua-before.png'),
    ('9dc397134fc3507d6ce9139717aa3f6a.png','fanghua-reference.png'),
    ('57160b76652984a113d6b2fdd0f57eac.png','tianyou-east-front-before.png'),
    ('01341ad998c245542a47833da45374ba.png','teaching9-remove-annex.png'),
    ('a78507898b1411713c1cf19911b63281.png','teaching7-before.png')]:
    if (wechat/filename).exists(): shutil.copyfile(wechat/filename,REF/target)
for filename,target in [
    ('codex-clipboard-bf621c14-f0ba-4a31-87d0-19b5c395c38e.png','dormitory2-overlap.png'),
    ('codex-clipboard-eb7ea3e2-5318-4ee7-a191-0214a9e42935.png','teaching7-reference.png'),
    ('codex-clipboard-e12b6969-2ec8-4b92-bde4-264a6fc4ea68.png','mao-century-clock-reference.png')]:
    path=Path('C:/Users/74286/AppData/Local/Temp')/filename
    if path.exists(): shutil.copyfile(path,REF/target)
for filename in ['official-forecourt.jpg','bjdzx90-preview.jpg','bjdzx90-all-directions.jpg',
                 'bjdzx93-all-directions.jpg','bjdzx90-pano.xml','bjdzx93-pano.xml',
                 'gadgets-13-12.xml']:
    if (temp/filename).exists(): shutil.copyfile(temp/filename,REF/filename)

SCALE=1.55
AX,AY=842,946
def p(u,v): return dict(x=round(AX+u*SCALE,3),y=round(AY+v*SCALE,3))
def rect(u,v,w,d): return dict(**p(u,v),width=round(w*SCALE,3),height=round(d*SCALE,3))
def block(u,v,w,d,h,f=3): return dict(**rect(u,v,w,d),elevation=h,floors=f)
def building(id,title,kind,blocks):
    minx=min(b['x'] for b in blocks); miny=min(b['y'] for b in blocks)
    return dict(id=id,title=title,kind=kind,blocks=blocks,x=minx,y=miny,
        width=max(b['x']+b['width'] for b in blocks)-minx,
        height=max(b['y']+b['height'] for b in blocks)-miny,
        elevation=max(b['elevation'] for b in blocks))

siyuan=json.loads((ROOT/'assets-source/campus-3d/siyuan/layout.json').read_text(encoding='utf-8'))
parts=[]
for old in siyuan['parts']:
    new={**old,'x':old['x']+192,'y':old['y']+96}
    parts.append(new)
buildings=[building(a['id'],a['title'],'siyuan',[{k:a[k] for k in ['x','y','width','height','elevation','floors']}]) for a in parts]
buildings += [
    building('InformationCenter','信息中心','white',[
        block(-410,-400,340,55,5.0,4),block(-410,-345,58,110,5.0,4),block(-128,-345,58,110,5.0,4)]),
    building('ScienceHall','科学会堂','auditorium',[block(435,-340,265,105,4.1,2),block(475,-365,130,25,5.1,2)]),
    building('Library','图书馆','library',[block(1030,-250,340,285,13.6,7)]),
    building('Teaching7','第七教学楼','teaching7',[block(280,175,440,80,5.8,4)]),
    building('Teaching5','第五教学楼','red-gable',[block(835,170,82,285,4.2,3),block(835,470,150,65,3.1,2)]),
    building('Teaching9','第九教学楼','teaching9',[
        dict(**block(200,640,640,85,9.4,6),role='rear'),
        dict(**block(200,725,85,105,8.8,6),role='west-north'),
        dict(**block(200,830,85,70,8.8,6),role='west-passage',bottom=2.25,collision=False),
        dict(**block(200,900,85,50,8.8,6),role='west-south'),
        dict(**block(755,725,85,225,8.8,6),role='east'),
        dict(**block(200,950,265,90,8.8,6),role='front-west'),
        dict(**block(465,950,110,90,10.1,6),role='front-center'),
        dict(**block(575,950,265,90,8.8,6),role='front-east'),
        dict(**block(285,790,470,45,4.5,3),role='crossbar')]),
    building('Archives','档案馆（校史馆）','red-gable',[block(-430,260,350,78,3.6,2)]),
    building('TianyouHall','天佑会堂','hall',[block(-390,455,285,230,7.2,2)]),
    building('Dormitory2','2号学生公寓','red-flat',[block(-430,1020,245,60,3.0,2)]),
    building('Services','商业服务网点','red-gable',[block(-430,1180,350,47,2.2,1)]),
    building('Admissions','招办、就创中心','service',[block(160,1140,200,50,2.4,2)]),
    building('Security','保卫处','service',[block(140,1225,80,55,2.0,1)]),
]
for a in buildings:
    if a['id']=='Arts':
        a['x']-=160*SCALE
        for b in a['blocks']: b['x']-=160*SCALE
    # Correct the neighbours of the previously omitted lawn, without squeezing
    # the actual lawn to fit an erroneous placeholder road/building arrangement.
    shift={'Teaching7':(105,0),'Teaching9':(185,0),'Arts':(185,0),
           'Admissions':(210,0),'Security':(210,0)}.get(a['id'])
    if shift:
        dx,dy=shift[0]*SCALE,shift[1]*SCALE
        a['x']+=dx;a['y']+=dy
        for b in a['blocks']: b['x']+=dx;b['y']+=dy
def road(name,w,uv,kind='road'): return dict(name=name,width=w,points=[p(*q) for q in uv],kind=kind)
roads=[road('银杏大道',84,[(-470,100),(1480,100)]),
       road('知行大道',74,[(-470,-450),(1450,-450)]),
       road('明湖路',44,[(745,-450),(745,100)]),
       road('西侧楼间路',48,[(-25,-450),(-25,100)]),
       road('东侧楼间路',56,[(389,-450),(389,100)]),
       road('南门入口道路',96,[(80,1120),(80,1370)]),
       road('草坪西侧道路',52,[(-60,100),(-60,700),(-140,790),(-140,1130)]),
       road('草坪东侧道路',52,[(345,100),(345,700),(240,790),(240,1130)]),
       road('草坪南侧横路',84,[(-60,700),(345,700)]),
       road('广场北侧横路',62,[(-140,770),(240,770)]),
       road('广场南侧横路',78,[(-140,1130),(345,1130)]),
       road('西侧环路',62,[(-480,100),(-480,1260)]),
       road('南侧环路',78,[(-480,1310),(1480,1310)]),
       road('东侧环路',66,[(1480,100),(1480,1310)]),
       road('教学区南路',72,[(345,600),(1480,600)]),
       road('教学区横向步道',20,[(385,360),(940,360)],'path'),
       road('第九楼前道路',66,[(345,1085),(1150,1085)]),
       road('档案馆前路',40,[(-480,365),(-60,365)]),
       road('会堂前路',54,[(-480,715),(80,715)]),
       road('思源楼入口',72,[(179,0),(179,100)],'path'),
       road('图书馆入口',96,[(1200,35),(1200,100)],'path')]

def rounded_outline(corners,samples=6):
    # Quadratic arcs through the midpoints of neighbouring control vertices.
    result=[]
    for i,b in enumerate(corners):
        a=corners[i-1];c=corners[(i+1)%len(corners)]
        start=((a[0]+b[0])/2,(a[1]+b[1])/2)
        end=((b[0]+c[0])/2,(b[1]+c[1])/2)
        for j in range(samples):
            t=j/samples
            result.append(p((1-t)**2*start[0]+2*t*(1-t)*b[0]+t*t*end[0],
                            (1-t)**2*start[1]+2*t*(1-t)*b[1]+t*t*end[1]))
    return result
lake=rounded_outline([(780,-290),(805,-355),(900,-340),(975,-305),(1008,-235),
                      (1000,-75),(960,-12),(850,5),(787,-35),(777,-125)])
lake_details=dict(pavilion=dict(**p(828,-78),radius=40),
    crescent=[p(u,v) for u,v in [(830,-342),(842,-327),(844,-307),(860,-291),
                                (883,-277),(883,-261),(858,-246),(829,-240),(803,-227),(782,-216)]],
    boardwalk=[p(786,-78),p(828,-78)],
    steps=[dict(**p(900,-329),width=52,depth=30),dict(**p(993,-190),width=48,depth=27)])
parks=[dict(id='EastGarden',title='芳华园',**rect(990,165,445,400)),
       dict(id='CentralLawn',title='思源楼前大草坪',**rect(-25,170,325,460)),
       dict(id='CentralGarden',title='教学区庭院',**rect(385,380,545,180)),
       dict(id='ArchiveGarden',title='档案馆前庭园',**rect(-430,390,330,95)),
       dict(id='SouthGarden',title='南门小广场树阵',**rect(-105,790,290,290))]
paths=[road('庭院横轴',18,[(385,450),(930,450)],'path'),
       road('2号公寓入口步道',22,[(-307.5,1080),(-307.5,1130)],'path'),
       road('第七楼入口轴',26,[(605,255),(605,460)],'path'),
       road('庭院东侧步道',18,[(930,285),(930,555),(605,555)],'path'),
       road('第九教学楼侧门步道',42,[(345,865),(470,865)],'path'),
       road('会堂绿地小径',20,[(-410,435),(-150,435),(-150,400),(-410,400)],'path')]
fanghua=dict(boundary=rounded_outline([(992,170),(1430,170),(1430,560),(992,560)],8),
    statue=dict(**p(1215,378),height=2.5),
    entrances=[rect(1005,295,55,40),rect(1325,190,60,45),rect(1300,485,85,42)],
    rocks=[p(1100,260),p(1305,320),p(1360,447)])
ring=[(1213+177*math.cos(i*math.tau/48),366+162*math.sin(i*math.tau/48)) for i in range(49)]
paths += [road('芳华园弧形环径',16,ring,'path'),
          road('芳华园入口轴',19,[(1005,315),(1215,378),(1380,515)],'path'),
          road('芳华园横轴',16,[(1080,490),(1215,378),(1330,230)],'path'),
          road('芳华园北支径',14,[(1070,255),(1140,290),(1215,378)],'path')]
seventh_garden=dict(statue=dict(**p(605,460),height=4.0),
    statueLawn=rect(568,423,74,74),statuePlaza=rect(555,410,100,100),
    clock=dict(**p(605,548),width=48,height=3.7),
    clockPlaza=rect(567,524,76,48))
next(a for a in buildings if a['id']=='TianyouHall')['front']='east'
courts=[dict(id='BasketballWest',**rect(-425,755,120,220)),dict(id='BasketballEast',**rect(-290,755,120,220))]
gate=dict(id='SouthGate',title='南门',**p(80,1240),width=128,depth=23,pillarWidth=14,elevation=5.4)
chests=[p(u,v) for u,v in [(80,1180),(240,1040),(345,730),(345,430),(65,90),(745,90),(1200,100),(1100,600)]]
spawn=p(80,1280)
obstacles=[{k:b[k] for k in ['x','y','width','height']} for a in buildings for b in a['blocks'] if b.get('collision',True)]
teaching9=next(a for a in buildings if a['id']=='Teaching9')
teaching9['courtyards']=[rect(470,725,470,65),rect(470,835,470,115)]
teaching9['sidePassage']=dict(**p(425,865),width=108.5,clearHeight=2.25)
teaching9['frontEntrance']=p(705,1040)
teaching9['detailObstacles']=[rect(660,1040,10,30),rect(740,1040,10,30)]
obstacles += teaching9['detailObstacles']
obstacles += [rect(597,452,16,16),rect(1208,371,14,14)]
for du in [-16,16]:
    for dv in [-16,16]: obstacles.append(rect(605+du-3,548+dv-3,6,6))
obstacles += [dict(x=gate['x']+side*gate['width']/2-gate['pillarWidth']/2,
                  y=gate['y']-gate['depth']/2,width=gate['pillarWidth'],height=gate['depth']) for side in [-1,1]]

def inside(point,poly):
    x,y=point['x'],point['y']; result=False
    for i,a in enumerate(poly):
        b=poly[i-1]
        if (a['y']>y)!=(b['y']>y) and x<(b['x']-a['x'])*(y-a['y'])/(b['y']-a['y'])+a['x']:
            result=not result
    return result
# Small conservative cells follow the actual shoreline, not a blocking lake AABB.
water=[]
for x in range(int(min(a['x'] for a in lake)),int(max(a['x'] for a in lake)),16):
    for y in range(int(min(a['y'] for a in lake)),int(max(a['y'] for a in lake)),16):
        if inside(dict(x=x+8,y=y+8),lake): water.append(dict(x=x,y=y,width=16,height=16))
obstacles += water

# Re-traced from official zoom2 crop cols24..29 / rows23..26, retrieved2026-11-20.
# The old Siyuan image anchor becomes (84,82) inside this crop.
# Actual lawn edges approximately (220,175),(490,17),(885,253),(600,415).
forecourt=dict(
    lawn=dict(**rect(-25,170,325,460),polygon=[p(u,v) for u,v in [(-25,170),(115,170),
        (115,225),(180,225),(180,170),(300,170),(300,630),(210,630),(210,605),
        (125,605),(125,630),(-25,630)]]),
    siyuanApron=rect(-25,115,325,55),
    flag=dict(**p(150,195),base=24,height=7.5),
    roundMonument=dict(**p(166,602),radius=42,height=2.8,title='饮水思源碑'),
    trafficIsland=dict(**rect(110,711,115,24),sculpture=p(162,723)),
    plaza=dict(**rect(-105,790,290,290),paving='sand with red border',
               polygon=[p(u,v) for u,v in [(-45,790),(185,790),(125,1080),(-105,1080)]],
               rows=6,columns=6,spacing=38),
    parking=rect(-105,1092,230,30),
    conifers=[p(u,v) for u,v in [(5,300),(60,420),(30,565),(85,530),(260,470),(255,560)]],
    trace=dict(cropColumns=[24,29],cropRows=[23,26],zoom=2,tileSize=256,
               imageAnchor=[84,82],logicalAnchor=[AX,AY],
               landmarks={'lawnNW':[220,175],'lawnNE':[490,17],
                          'lawnSE':[885,253],'lawnSW':[600,415],
                          'monument':[730,306],'southGateGround':[1220,650]},
               panorama='https://map.bjtu.edu.cn/qj/bjdzx90/index.html'))
for feature in [forecourt['flag'],forecourt['roundMonument']]:
    radius=8 if 'base' in feature else feature['radius']*.80
    obstacles.append(dict(x=feature['x']-radius,y=feature['y']-radius,width=radius*2,height=radius*2))
island=forecourt['trafficIsland']
obstacles.append({k:island[k] for k in ['x','y','width','height']})

def segment_distance(pt,a,b):
    dx,dy=b['x']-a['x'],b['y']-a['y']; dot=dx*dx+dy*dy
    t=max(0,min(1,((pt['x']-a['x'])*dx+(pt['y']-a['y'])*dy)/dot)) if dot else 0
    return math.hypot(pt['x']-a['x']-t*dx,pt['y']-a['y']-t*dy)
def blocked(pt,pad=30):
    if any(a['x']-pad<pt['x']<a['x']+a['width']+pad and a['y']-pad<pt['y']<a['y']+a['height']+pad for a in obstacles): return True
    if any(segment_distance(pt,a,b)<r['width']/2+18 for r in roads+paths for a,b in zip(r['points'],r['points'][1:])): return True
    if any(math.hypot(pt['x']-c['x'],pt['y']-c['y'])<75 for c in chests): return True
    if any(a['x']-20<pt['x']<a['x']+a['width']+20 and a['y']-20<pt['y']<a['y']+a['height']+20 for a in courts): return True
    return False
trees=[]
def tree(u,v,variant=0):
    point=p(u,v)
    if not blocked(point,20): trees.append(dict(**point,variant=variant))
for u in range(-430,1470,48):
    tree(u,48,u%3)
    tree(u,150,(u+1)%3)
    tree(u,-390,u%3)
for v in range(190,1290,56):
    tree(1090,v,v%3)
for park in parks:
    if park['id'] in ['CentralLawn','SouthGarden']: continue
    for i in range(10):
        uu=(park['x']-AX)/SCALE+(i*73%int(park['width']/SCALE))
        vv=(park['y']-AY)/SCALE+(i*47%int(park['height']/SCALE))
        tree(uu,vv,i%3)
for v in range(210,630,42):
    tree(-27,v,1);tree(302,v,1)
for point in forecourt['conifers']:
    trees.append(dict(**point,variant=2))
for row in range(forecourt['plaza']['rows']):
    for col in range(forecourt['plaza']['columns']):
        # Array starts inside the paving with an offset row pattern, as in the map.
        tree(-30+col*38-row*8,820+row*43,0)
for u,v,variant in [(770,-315,3),(810,-370,0),(865,-365,0),(930,-350,1),
                    (1004,-288,0),(1018,-55,1),(958,15,1),(880,30,0),(820,22,3),(768,-75,3)]:
    tree(u,v,variant)
for t in trees: obstacles.append(dict(x=t['x']-7,y=t['y']-7,width=14,height=14))

data=dict(id='south-campus-district',unitsPerMetre=32,width=3264,height=3328,
          reference=dict(kind='user-selected-oblique-campus-artwork',groundAnchorImage=[220,365],
                         referenceScale=.41,projectionAngle=30,logicalAnchor=[AX,AY],
                         logicalUnitsPerGroundPixel=SCALE,previousSiyuanOffset=[192,96],
                         limitations=['建筑身份与分离关系依用户标注；遮挡背侧、楼高、路宽为估算。',
                                      '保留截图内建筑、湖、道路、院落的相对位置；不声称测绘精度。']),
          parts=parts,buildings=buildings,roads=roads,paths=paths,parks=parks,lake=lake,lakeDetails=lake_details,
          waterObstacles=water,courts=courts,gate=gate,trees=trees,obstacles=obstacles,
          forecourt=forecourt,fanghua=fanghua,seventhGarden=seventh_garden,
          spawn=spawn,extraction=dict(**p(43,1260),width=115,height=105),chests=chests,
          landmarks=[dict(id=a['id'],title=a['title'],x=a['x']+a['width']/2,y=a['y']+a['height']/2,elevation=a['elevation']) for a in buildings]
                    +[dict(id='SouthGate',title='南门',x=gate['x'],y=gate['y'],elevation=gate['elevation']),
                      dict(id='MingLake',title='明湖',**p(910,-170),elevation=.2),
                      dict(id='Basketball',title='天佑南侧篮球场',**p(-265,870),elevation=.1),
                      dict(id='SiyuanTime',title='思源时光',**p(1120,950),elevation=.1)])
(SOURCE/'layout.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
provenance=dict(kind='reference-reconstruction',permission='用户已授权网站资源复用，并指定此截图区域建模。',
               references=['district-user.png','district-names-user.png'],
               previousSource='../siyuan/reference/sources.json',
               reconstruction='本项目 Blender 新建与复用已建思源楼、校门几何体，不是官网原始三维数据。',
               assumptions=data['reference']['limitations'])
provenance['teaching9Refinement']=dict(references=['teaching9-map.png','teaching9-front.png','teaching9-side.png'],
    features='平顶高低楼体、两处院落与横向低体、中央石材门廊和玻璃、侧面底层通道、长窗、空调与屋顶构架。',
    limitations='依据照片和斜视图估算比例；未复制照片中的文字标语、浮雕图案或真实室内。')
provenance['forecourtRefinement']=dict(retrievedAt='2026-11-20',
    website='https://map.bjtu.edu.cn/',tilePattern='mapdata/zoom2/{column}_{row}.jpg?v=20260624',
    columns=[24,29],rows=[23,26],
    panoramas=['qj/bjdzx90/index.html','qj/bjdzx93/index.html','qj/bjdzx101/index.html','qj/bjdzx97/index.html'],
    findings='完整大草坪位于思源楼正前方，路在草坪两侧；南端饮水思源碑，南侧横路、岛状绿地与小广场树阵，之后是停车带和南门。',
    limits='现场全景与地图美术的年代、树木生长状态不同；按地图恢复边界，以全景核对景观身份与朝向。')
provenance['landmarkRefinement']=dict(date='2026-11-20',
    references=['basketball-overlap.png','tianyou-front.png','ming-lake-map.png','library-map.png','library-front.png'],
    features='球场退让道路；会堂深檐玻璃与格栅；五星红旗标准排布；圆润湖岸、近岸重檐亭及弧形浅水边；图书馆分层多边形阅览翼与蓝玻璃中庭。',
    limits='按用户提供官网截图及现场照片重建；未提供的背面、尺寸和细节为估算。')
provenance['layoutCorrection20261121']=dict(
    references=['dormitory2-overlap.png','fanghua-reference.png','tianyou-east-front-before.png',
                'teaching7-reference.png','mao-century-clock-reference.png','teaching9-remove-annex.png'],
    changes='2号公寓保持在广场西侧并缩短东端；东侧环路绕芳华园东缘；会堂东面改正立面并加竖排金字；删除第九楼右侧小红房；精修第七楼，前庭加入毛主席像及其前方世纪钟。',
    limits='平面关系依据用户官网截图校正；背面和尺寸为估算，雕像为低模轮廓表达。')
(REF/'sources.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def image_point(pt):
    u=(pt['x']-AX)/SCALE; v=(pt['y']-AY)/SCALE
    return (220+.41*math.cos(math.pi/6)*(u+v),365+.41*.5*(-u+v))
im=Image.open(REF/'district-user.png').convert('RGB'); draw=ImageDraw.Draw(im)
for a in buildings:
    for b in a['blocks']:
        pts=[image_point(q) for q in [dict(x=b['x'],y=b['y']),dict(x=b['x']+b['width'],y=b['y']),
                                      dict(x=b['x']+b['width'],y=b['y']+b['height']),dict(x=b['x'],y=b['y']+b['height'])]]
        draw.line(pts+[pts[0]],fill='#00eacc',width=2)
for r in roads:
    draw.line([image_point(q) for q in r['points']],fill='#ffcd55',width=2)
draw.line([image_point(q) for q in lake+[lake[0]]],fill='#4cbaff',width=3)
im.save(REF/'ground-layout-trace.jpg')
print(f'District layout: {len(buildings)} buildings, {len(trees)} trees, {len(obstacles)} colliders')
