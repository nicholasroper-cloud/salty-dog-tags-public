#!/usr/bin/env python3
"""render.py in.svg out.png W H [bg]  -> renders SVG at exactly WxH px (transparent unless bg given)"""
import sys, subprocess, tempfile, os, pathlib
from PIL import Image
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
def render(svg, out, w, h, bg=None):
    svg=os.path.abspath(svg); w=int(w); h=int(h)
    ww=max(w,520); wh=max(h,200)
    d=tempfile.mkdtemp(dir=os.environ.get('TMPDIR'))
    html=os.path.join(d,'r.html')
    bgcss=bg or 'transparent'
    pathlib.Path(html).write_text(f'<!doctype html><html><body style="margin:0;background:{bgcss}"><img src="file://{svg}" style="display:block;width:{w}px;height:{h}px"></body></html>')
    shot=os.path.join(d,'s.png')
    subprocess.run([CH,'--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1',
        f'--user-data-dir={d}/u','--default-background-color=00000000',f'--window-size={ww},{wh}',
        f'--screenshot={shot}','--virtual-time-budget=2000','file://'+html],capture_output=True,timeout=60)
    im=Image.open(shot).convert('RGBA').crop((0,0,w,h)); im.save(out)
    return out
if __name__=='__main__':
    a=sys.argv; render(a[1],a[2],a[3],a[4],a[5] if len(a)>5 else None); print(a[2])
