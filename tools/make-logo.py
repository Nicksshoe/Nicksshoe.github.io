"""Draws the Potential Damage logo into brand/. Merged PD logo: the owner's look (big bold letters, pink outlines + pink offset, explosive burst, cyan D)
built to the rule set (exact palette, one offset, shared baseline, patterned centred burst, separate favicon).
Run: py -3 -I tools/make-logo.py brand   (then copy brand/pd-favicon.svg to favicon.svg and re-export icon-180.png / favicon.ico)"""
import math, sys, os

out = sys.argv[1]
PAL = {
    "dark":  dict(gold="#ffd23f", pink="#ff3ea5", cyan="#3ef0ff"),
    "light": dict(gold="#ffd23f", pink="#d1006a", cyan="#3ef0ff"),
}

def star(cx, cy, r_long, r_short, r_valley):
    pts = []
    for i in range(16):
        a = math.radians(i * 22.5)                      # 0 = north, clockwise
        r = r_valley if i % 2 else (r_long if (i // 2) % 2 == 0 else r_short)
        pts.append((round(cx + r * math.sin(a)), round(cy - r * math.cos(a))))
    return "M" + " L".join(f"{x},{y}" for x, y in pts) + " Z"

# ---- main mark, viewBox 512, 8-unit grid ----
OFF = 24                 # the one shadow offset (down-right), letters only; the burst has a pink outline but no shadow
LINE = 8                 # pink outline width
TOP, BASE = 152, 360     # cap height 208, one baseline for both letters
STEM, T = 64, 48         # stem width; bowl thickness
# P: stem x 120-184, bowl from the top down to y 280 (radius 64); hole is see-through.
PX, PB = 120, 280
PR = (PB - TOP) // 2
P = (f"M{PX},{TOP} H{PX+STEM} A{PR},{PR} 0 0 1 {PX+STEM},{PB} V{BASE} H{PX} Z "
     f"M{PX+STEM},{TOP+T} A{PR-T},{PR-T} 0 0 1 {PX+STEM},{PB-T} Z")
# D: stem x 216-280 (tucked 32 under the P's bowl), outer radius 104, hole radius 56 (cyan).
DX = 216
DR = (BASE - TOP) // 2
D_OUT = f"M{DX},{TOP} H{DX+STEM} A{DR},{DR} 0 0 1 {DX+STEM},{BASE} H{DX} Z"
D_HOLE = f"M{DX+STEM},{TOP+T} A{DR-T},{DR-T} 0 0 1 {DX+STEM},{BASE-T} Z"
BURST = star(256, 256, 232, 208, 96)     # centred; long points 232, diagonals 208, deep valleys for a sharp explosion

def mark(c):
    line = f'stroke="{c["pink"]}" stroke-width="{LINE}" stroke-linejoin="miter" stroke-miterlimit="4"'
    sh = f'transform="translate({OFF} {OFF})"'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<path d="{BURST}" fill="{c["gold"]}" {line}/>
<path d="{D_OUT}" fill="{c["pink"]}" {line} {sh}/>
<path d="{D_OUT} {D_HOLE}" fill="{c["gold"]}" fill-rule="evenodd" {line}/>
<path d="{D_HOLE}" fill="{c["cyan"]}"/>
<path d="{P}" fill="{c["pink"]}" fill-rule="evenodd" {line} {sh}/>
<path d="{P}" fill="{c["gold"]}" fill-rule="evenodd" {line}/>
</svg>
'''

# ---- favicon, viewBox 32, whole units: bold P on the burst ----
F_BURST = star(16, 16, 15, 13, 7)
FP = "M9,6 H15 A5,5 0 0 1 15,16 V24 H9 Z M15,10 A1,1 0 0 1 15,12 Z"

def favicon(c):
    line = f'stroke="{c["pink"]}" stroke-width="2" stroke-linejoin="miter"'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<path d="{F_BURST}" fill="{c["gold"]}"/>
<path d="{FP}" fill="{c["pink"]}" fill-rule="evenodd" {line} transform="translate(2 2)"/>
<path d="{FP}" fill="{c["gold"]}" fill-rule="evenodd" {line}/>
</svg>
'''

os.makedirs(out, exist_ok=True)
for mode in ("dark", "light"):
    sfx = "" if mode == "dark" else "-light"
    open(os.path.join(out, f"pd-mark{sfx}.svg"), "w", encoding="utf-8").write(mark(PAL[mode]))
    open(os.path.join(out, f"pd-favicon{sfx}.svg"), "w", encoding="utf-8").write(favicon(PAL[mode]))
print(BURST)
