"""Trace the website's oblique ground plane; keep image coordinates for audit.

The map is artwork, not survey data. Roof silhouettes must NOT be used as
ground footprints: its vertical extrusion is removed by tracing ground edges.
"""
import json
import math
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets-source/campus-3d/siyuan'
DEST.mkdir(parents=True, exist_ok=True)
REF = DEST / 'reference'
REF.mkdir(exist_ok=True)
TEMP = ROOT / 'artifacts/campus-3d/siyuan'
for source, target in [('siyuan-map.jpg', 'website-map.jpg'),
                       ('qj_bjdzx101_preview.jpg', 'entrance-photo.jpg'),
                       ('tips-1-49-43.xml', 'website-building-hit-polygon.xml')]:
    if (TEMP / source).exists():
        shutil.copyfile(TEMP / source, REF / target)
    elif not (REF / target).exists():
        raise FileNotFoundError(f'Missing retained reference: {REF / target}')

# User-supplied corrections are retained as visual evidence, not executable input.
USER_REFS = {
    'east-building-user.png': 'de543a5f77fd0afaaee8cf6cea73af37.png',
    'west-building-user.png': 'e3b6ef41d3e2910c5de878d2f086be23.png',
}
USER_DIR = Path('D:/xwechat_files/wxid_o05x5idh6q7y22_fc91/temp/RWTemp/2026-11/9e20f478899dc29eb19741386f9343c8')
for target, source in USER_REFS.items():
    if (USER_DIR/source).exists():
        shutil.copyfile(USER_DIR/source, REF/target)

# Local crop pixel coordinates; reference crop is zoom2 columns23..26 rows20..23.
# u follows the frontage/avenues (image upper-right), v follows Minghu Road.
SCALE = 1.55
ORIGIN = (340, 850)
def image_point(u, v):
    return [round(ORIGIN[0] + math.cos(math.pi/6)*(u+v), 3),
            round(ORIGIN[1] + .5*(-u+v), 3)]
def game_point(u, v):
    return {'x': round(650 + u*SCALE, 3), 'y': round(850 + v*SCALE, 3)}
def rect(name, title, u, v, w, d, h, floors):
    return dict(id=name, title=title, **game_point(u,v), width=round(w*SCALE,3),
                height=round(d*SCALE,3), elevation=h, floors=floors,
                referenceGroundCorners=[image_point(u,v),image_point(u+w,v),
                                        image_point(u+w,v+d),image_point(u,v+d)])

# These are THREE independent buildings. Never fill either road with a connector.
parts = [rect('West', '思源西楼', -315,-175,265,137,10.7,8),
         rect('Main', '思源楼', 0,-130,358,130,16.4,11),
         rect('East', '思源东楼', 420,-165,295,137,10.7,8)]
roads = [dict(name='银杏大道', width=84, points=[game_point(-420,100),game_point(820,100)]),
         dict(name='知行大道', width=82, points=[game_point(-420,-450),game_point(820,-450)]),
         dict(name='明湖路', width=72, points=[game_point(820,-510),game_point(820,360)]),
         dict(name='楼前入口', width=96, points=[game_point(179,0),game_point(179,100)]),
         dict(name='西侧楼间路', width=48, points=[game_point(-25,-450),game_point(-25,100)]),
         dict(name='东侧楼间路', width=56, points=[game_point(389,-450),game_point(389,100)])]
context_landmarks = [
    dict(id='InformationCenter',title='信息中心',behind='West',status='待建',**game_point(-180,-300)),
    dict(id='ScienceHall',title='科学会堂',behind='East',status='待建',**game_point(560,-300)),
]
trees = []
for u in [-285,-230,-175,-120,-65,15,70,285,345,410,465,520,575,630,675]:
    p=game_point(u,52)
    trees.append(dict(**p,variant=len(trees)%2))
for u in [-300,-160,60,180,300,460,580,710]:
    p=game_point(u,-367)
    trees.append(dict(**p,variant=len(trees)%2))
data = dict(unitsPerMetre=32, width=2112, height=1536,
    reference=dict(website='https://map.bjtu.edu.cn/',version='20260624',
        marker={'title':'思源楼','x':12749,'y':11212},
        crop={'level':2,'tileSize':256,'columns':[23,26],'rows':[20,23]},
        projection={'kind':'inferred-isometric-ground-plane','angleDegrees':30,
                    'cropAnchor':list(ORIGIN),'gameAnchor':[650,850],
                    'logicalUnitsPerGroundPixel':SCALE},
        limitations=['官网 JPG 是斜视绘图，并非地籍或测绘图；不能从屋顶命中多边形直接得到占地。',
                    '思源楼、思源东楼、思源西楼为独立建筑，楼间通路依据用户纠正；路宽与楼高仍为缩略估算。',
                    '统一缩略尺度保留局部位置关系，不声称地理坐标或毫米级一致。']),
    parts=parts, roads=roads, trees=trees, contextLandmarks=context_landmarks,
    spawn=game_point(179,155),
    extraction=dict(**game_point(145,130),width=106,height=86),
    chests=[game_point(u,v) for u,v in [(65,90),(295,90),(-220,90),(520,90),
                                     (745,-210),(170,-225),(-360,-215),(389,-225)]])
(DEST/'layout.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
provenance=dict(retrievedAt='2026-11-20',permission='用户已明确授权复用官网资源，要求思源楼样板。',
    kind='reference-reconstruction',mesh='本项目 Blender 重建；非官网原始三维网格。',
    mapUrlPattern='https://map.bjtu.edu.cn/mapdata/zoom2/{x}_{y}.jpg?v=20260624',
    panorama='https://map.bjtu.edu.cn/qj/bjdzx101/index.html',
    panoramaPreview='https://map.bjtu.edu.cn/qj/bjdzx101/preview.jpg',
    xml='https://map.bjtu.edu.cn/xml/tips/1/49_43.xml',
    xmlUsage='仅用于官网楼名及图像轮廓核对，非平面碰撞数据。',
    userCorrection={'eastReference':'east-building-user.png','westReference':'west-building-user.png',
                    'buildings':'思源楼、思源东楼、思源西楼互不相连，楼间有道路。',
                    'rearContext':'东楼后方是科学会堂；西楼后方是信息中心。两者只标位，尚未建模。'},
    sourceImagesUsage='建模与对照，运行时不加载外站或全景图片。')
(REF/'sources.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# A reproducible annotated comparison: roof heights differ from traced ground.
from PIL import Image, ImageDraw
im=Image.open(REF/'website-map.jpg').convert('RGB')
draw=ImageDraw.Draw(im)
for part in parts:
    pts=[tuple(p) for p in part['referenceGroundCorners']]
    draw.line(pts+[pts[0]],fill='#00ffee',width=3)
    draw.text(pts[0],part['id'],fill='#002a24',stroke_width=1,stroke_fill='white')
for road in roads:
    pts=[]
    for p in road['points']:
        pts.append(tuple(image_point((p['x']-650)/SCALE,(p['y']-850)/SCALE)))
    draw.line(pts,fill='#ffdc53',width=4)
draw.text((18,18),'CYAN: ground estimates / YELLOW: road axes',fill='black',stroke_width=2,stroke_fill='white')
im.save(REF/'layout-trace.jpg')
print('Wrote Siyuan layout and reference trace')
