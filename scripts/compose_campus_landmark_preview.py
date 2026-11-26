"""A compact review sheet of the actual exported-model renders."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts/campus-3d/landmarks'
canvas=Image.new('RGB',(1600,1332),'#edf0e8');draw=ImageDraw.Draw(canvas)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',26)
small=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
for i,(name,label) in enumerate([('tianyou','天佑会堂 · 深檐、玻璃入口与遮阳格栅'),
                                ('library','图书馆 · 分层阅览翼与中央蓝玻璃'),
                                ('ming-lake','明湖 · 圆润岸线、浅水边与近岸重檐亭'),
                                ('flag','五星红旗 · 3:2 旗面与五颗金星')]):
    x=(i%2)*800;y=(i//2)*650
    image=Image.open(OUT/(name+'.png')).convert('RGB').resize((800,600),Image.Resampling.LANCZOS)
    canvas.paste(image,(x,y));draw.text((x+18,y+609),label,font=font,fill='#2e443c')
draw.text((18,1300),'实际 GLB 模型预览；游戏内继续使用人物环绕镜头。',font=small,fill='#456055')
canvas.save(OUT/'refinement-preview.jpg',quality=92)
