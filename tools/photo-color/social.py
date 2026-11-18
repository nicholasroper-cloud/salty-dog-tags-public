import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
F='/private/tmp/claude-501/-Users-nick/6ad81fa5-55b6-47c7-84fd-f526aad5c6c2/scratchpad/fonts/'
LOGO='/Users/nick/Clover API TB/saltydogtags/site/assets/logo/logo-final-horizontal-dark@2x.png'
FOAM=(255,244,250); MAG=(255,46,151); CYAN=(0,229,255)
def bungee(d, xy, text, size, anchor='la', offset=True):
    f=ImageFont.truetype(F+'Bungee-Regular.ttf', size)
    if offset:
        o=round(size*0.72*0.075)
        d.text((xy[0]+o, xy[1]+o), text, font=f, fill=MAG, anchor=anchor)
    d.text(xy, text, font=f, fill=FOAM, anchor=anchor)
def mono(d, xy, text, size, fill, anchor='la', track=0.0):
    f=ImageFont.truetype(F+'DMMono-Medium.ttf', size)
    if not track: d.text(xy, text, font=f, fill=fill, anchor=anchor); return f.getlength(text)
    w=sum(f.getlength(c) for c in text)+track*size*(len(text)-1)
    x=xy[0]-(w/2 if anchor[0]=='m' else w if anchor[0]=='r' else 0)
    for c in text:
        d.text((x, xy[1]), c, font=f, fill=fill, anchor='l'+anchor[1]); x+=f.getlength(c)+track*size
    return w
if __name__=='__main__':
    im=Image.open('out/social-base.png').convert('RGBA'); d=ImageDraw.Draw(im)
    mono(d,(70,92),'NEW  ·  PHOTO TAGS',26,CYAN,'ls',track=0.18)
    bungee(d,(66,190),'THE MUGSHOT',86,'ls')
    bungee(d,(66,282),'TAG.',86,'ls')
    mono(d,(70,340),"Your dog's face, lasered into steel.",28,FOAM,'ls')
    logo=Image.open(LOGO).convert('RGBA'); h=74; logo=logo.resize((round(logo.width*h/logo.height),h),Image.LANCZOS)
    im.alpha_composite(logo,(70,1080-70-h))
    mono(d,(1010,1080-70-h/2),'@saltydogtagsco',28,FOAM,'rm')
    im.convert('RGB').save(sys.argv[1], optimize=True)
