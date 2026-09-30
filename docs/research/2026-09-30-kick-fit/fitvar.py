import json, copy, numpy as np, scipy.optimize as so, sys, os
from fit import render; import wfit; from wfit import wscore
mach,START,REF,OUT,secs=sys.argv[1:6]; os.environ['SECS']=secs
p1=json.load(open(START)) if START.endswith('.json') else json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../packages/engine/src/patches',START+'.json')))['patch']
if mach=='909':
    wfit.EDGE.update(on=True,pre=0.0015)
    t0,tp,ta=4,150,float(sys.argv[6])
    a,b,c,d=p1['ops']
    x0=[p1['pitchEnvAmount'],p1['pitchEnv']['decayTime'],p1['pitchEnv']['decayCurve'],a['env']['decayTime'],a['env']['releaseTime'],a['env']['releaseCurve'],
        a['phase'],a['feedback'],c['level'],d['level'],b['phase'],b['fixedHz'],b['level'],b['env']['decayTime']]
    lo=np.array([8,0.01,-1,0.005,0.03,-1,0,-1,0,0,0,20,0,0.0005]); hi=np.array([48,0.4,1,0.3,1.5,1,1,1,1,1,1,2000,1,0.02])
    def build(v):
        amt,pdt,pdc,t1,t2,c2,phA,fbA,lvC,lvD,phB,fB,lvB,tB=v
        p=copy.deepcopy(p1); p['pitchEnvAmount']=amt; p['pitchEnv'].update(decayTime=pdt,decayCurve=pdc)
        p['ops'][0]['env'].update(decayTime=t1,releaseTime=t2,releaseCurve=c2); p['ops'][0].update(phase=phA,feedback=fbA)
        p['ops'][2]['level']=lvC; p['ops'][3]['level']=lvD
        p['ops'][1].update(fixedHz=fB,phase=phB,level=lvB); p['ops'][1]['env']['decayTime']=tB
        return p
else:
    wfit.EDGE['on']=False
    t0,tp,ta=2,150,float(sys.argv[6])
    pe=p1['pitchEnv']; a,b,c,d=p1['ops']
    x0=[p1['pitchEnvAmount'],pe['attackTime'],pe['decayTime'],pe['sustainLevel'],pe['releaseTime'],pe['releaseCurve'],a['env']['attackTime'],a['env']['decayTime'],a['env']['decayCurve'],a['phase'],b['level'],b['env']['decayTime'],c['fixedHz'],c['phase'],c['level'],c['env']['decayTime']]
    lo=np.array([6,0.0005,0.0005,0,0.01,-1,0.0005,0.03,-1,0,0,0.0005,20,0,0,0.0005]); hi=np.array([36,0.01,0.01,0.6,0.4,1,0.02,6,1,1,1,0.03,2000,1,1,0.02])
    def build(v):
        amt,th,td,s,tr,cr,tA,dt,dc,phA,lvB,tB,fC,phC,lvC,tC=v
        p=copy.deepcopy(p1); p['pitchEnvAmount']=amt; p['pitchEnv'].update(attackTime=th,decayTime=td,sustainLevel=s,releaseTime=tr,releaseCurve=cr)
        p['ops'][0]['env'].update(attackTime=tA,decayTime=dt,decayCurve=dc); p['ops'][0]['phase']=phA
        p['ops'][1]['level']=lvB; p['ops'][1]['env']['decayTime']=tB
        p['ops'][2].update(fixedHz=fC,phase=phC,level=lvC); p['ops'][2]['env']['decayTime']=tC
        return p
x0=np.clip(np.array(x0,float),lo,hi)
def f(v):
    v=np.clip(v,lo,hi); return wscore(REF,render(build(v),56),t0,tp,ta)
s0=f(x0)
r=so.minimize(f,x0,method='Nelder-Mead',options=dict(maxfev=int(os.environ.get('FEV',700)),xatol=1e-4,fatol=1e-5,adaptive=True))
v=np.clip(r.x,lo,hi)
print(OUT,'start',round(s0,3),'best',round(r.fun,3),wscore(REF,render(build(v),56),t0,tp,ta,verbose=True))
json.dump(build(v),open(OUT,'w'),indent=1)
