"""Overlay the shared ground coordinates on official high-resolution map pixels."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'assets-source/campus-3d/district'
layout=json.loads((source/'layout.json').read_text(encoding='utf-8'))
f=layout['forecourt'];t=f['trace'];im=Image.open(source/'reference/official-forecourt.jpg').convert('RGB')
draw=ImageDraw.Draw(im)
def pixel(p):
    u=(p['x']-t['logicalAnchor'][0])/1.55;v=(p['y']-t['logicalAnchor'][1])/1.55
    return (t['imageAnchor'][0]+math.cos(math.pi/6)*(u+v),t['imageAnchor'][1]+.5*(-u+v))
def outline(points,color): draw.line([pixel(p) for p in points+[points[0]]],fill=color,width=3)
outline(f['lawn']['polygon'],'#14ffee')
outline(f['plaza']['polygon'],'#ffbb48')
for obj in [f['parking']]:
    x,y,w,h=obj['x'],obj['y'],obj['width'],obj['height']
    outline([dict(x=x,y=y),dict(x=x+w,y=y),dict(x=x+w,y=y+h),dict(x=x,y=y+h)],'#ffbb48')
for road in layout['roads']:
    if any(word in road['name'] for word in ['草坪','广场','南门入口']):
        draw.line([pixel(p) for p in road['points']],fill='#ef8cf5',width=2)
for name,point in [('monument',f['roundMonument']),('flag',f['flag']),('gate',layout['gate'])]:
    x,y=pixel(point);draw.ellipse((x-6,y-6,x+6,y+6),outline='white',width=2);draw.text((x+8,y),name,fill='black',stroke_width=1,stroke_fill='white')
im.save(source/'reference/forecourt-ground-trace.jpg')
