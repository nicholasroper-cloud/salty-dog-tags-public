import sys; sys.path.insert(0,'.')
from social import *
items=[('photo-tag-bone','PHOTO TAG · BONE','Polished stainless, paw cut-out. Dithered photo front,','name + phone in black on the back.'),
       ('photo-tag-round','PHOTO TAG · ROUND','32 mm polished stainless. Dithered photo front,','name + phone in black on the back.'),
       ('color-tag-bone','COLOR TAG · BONE','Line 1 gold oxide, paw blue oxide, purple halo on','the cut-out. Rest of the saying in black.'),
       ('color-tag-military','COLOR TAG · MILITARY','Line 1 gold oxide, paw blue oxide, purple ring on','the hole (no cut-out on this blank).')]
W,TW,TH,G,M=1600,752,564,32,32
H=150+2*(TH+120)+40
im=Image.new('RGBA',(W,H),(13,2,33,255)); d=ImageDraw.Draw(im)
mono(d,(M,58),'SALTY DOG TAGS  ·  MOCKUPS  ·  NOT FOR SALE YET',22,CYAN,'ls',track=0.16)
bungee(d,(M,124),'PHOTO TAGS & COLOR',60,'ls')
for i,(f,t,a,b) in enumerate(items):
    x=M+(i%2)*(TW+G); y=150+(i//2)*(TH+120)
    im.alpha_composite(Image.open(f'out/{f}.png').convert('RGBA').resize((TW,TH),Image.LANCZOS),(x,y))
    mono(d,(x,y+TH+38),t,24,CYAN,'ls',track=0.12)
    mono(d,(x,y+TH+70),a,20,FOAM,'ls'); mono(d,(x,y+TH+98),b,20,FOAM,'ls')
im.convert('RGB').save('out/photo-color-sheet.png',optimize=True); print(im.size)
