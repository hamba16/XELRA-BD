import math
def hex2rgb(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def lin(c): c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def lum(h): r,g,b=[lin(x) for x in hex2rgb(h)]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def to_oklab(h):
    r,g,b=[lin(x) for x in hex2rgb(h)]
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b
    m=0.2119034982*r+0.6806995451*g+0.1073969566*b
    s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l,m,s=[x**(1/3) for x in (l,m,s)]
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s, 1.9779984951*l-2.4285922050*m+0.4505937099*s, 0.0259040371*l+0.7827717662*m-0.8086757660*s)
def from_oklab(L,a,b):
    l=(L+0.3963377774*a+0.2158037573*b)**3; m=(L-0.1055613458*a-0.0638541728*b)**3; s=(L-0.0894841775*a-1.2914855480*b)**3
    r=4.0767416621*l-3.3077115913*m+0.2309699292*s; g=-1.2684380046*l+2.6097574011*m-0.3413193965*s; bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    def enc(x): x=max(0,min(1,x)); return round(255*(12.92*x if x<=0.0031308 else 1.055*x**(1/2.4)-0.055))
    return '#%02x%02x%02x'%(enc(r),enc(g),enc(bb))
def mix(h1,h2,t):
    a=to_oklab(h1); b=to_oklab(h2); return from_oklab(*[a[i]+(b[i]-a[i])*t for i in range(3)])
RED,IND='#991923','#0d3251'
for name,base in (('red',RED),('indigo',IND)):
    ramp=[mix(base,'#ffffff',t) for t in (0.92,0.82,0.64,0.40,0.0)]
    print(name,'tints 50..500(base):',ramp,' deep:',mix(base,'#000000',0.35))
print()
pairs=[('ink on paper','#111111','#f7f7f5'),('muted #646464 on paper','#646464','#f7f7f5'),('muted #5a5a58 on paper','#5a5a58','#f7f7f5'),
('white on red','#ffffff',RED),('white on indigo','#ffffff',IND),('red on white','#991923','#ffffff'),('red on paper','#991923','#f7f7f5'),
('indigo on paper','#0d3251','#f7f7f5'),('red on near-black #080808','#991923','#080808'),
('red tint 64% on #080808',mix(RED,'#ffffff',0.64),'#080808'),('red tint 40% on #080808',mix(RED,'#ffffff',0.40),'#080808'),
('indigo on #080808','#0d3251','#080808'),('indigo tint 64% on #080808',mix(IND,'#ffffff',0.64),'#080808'),('indigo tint 40% on #080808',mix(IND,'#ffffff',0.40),'#080808'),
('line #dcdcd9 on paper (non-text 3:1)','#dcdcd9','#f7f7f5'),('line strong #a8a8a3 on paper','#a8a8a3','#f7f7f5'),
('success #1f6f4a on paper','#1f6f4a','#f7f7f5'),('warning #8a5300 on paper','#8a5300','#f7f7f5'),('info indigo-tint #2f6a9e on paper','#2f6a9e','#f7f7f5'),
('white on ink #111','#ffffff','#111111'),('paper on ink #111','#f7f7f5','#111111'),('muted-dark #a3a3a0 on #080808','#a3a3a0','#080808')]
for n,f,b in pairs:
    r=cr(f,b); print(f"{n:42s} {f} on {b}  {r:5.2f}:1  {'AA text' if r>=4.5 else ('AA large/UI' if r>=3 else 'FAIL')}")
# modular type scale 1.2 from 14
print([round(14*1.2**i,1) for i in range(0,9)])
