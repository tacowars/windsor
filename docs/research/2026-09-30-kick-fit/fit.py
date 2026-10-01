import json, subprocess, os, tempfile, numpy as np, scipy.signal as ss
from ana import load, onset
S=os.path.dirname(os.path.abspath(__file__))
def cyc(f):
    sr,x=load(f); x=x[max(0,onset(x)-2):].astype(float)
    lp=ss.sosfiltfilt(ss.butter(2,500,'lp',fs=sr,output='sos'),x)
    zc=np.where(np.diff(np.signbit(lp)))[0]
    zt=np.array([(z+lp[z]/(lp[z]-lp[z+1]))/sr*1000 for z in zc])
    t=(zt[:-2]+zt[2:])/2; hz=1000/(zt[2:]-zt[:-2])
    pk=np.array([np.abs(lp[zc[i]:zc[i+2]+1]).max() for i in range(len(zc)-2)])
    return t,hz,pk
def render(patch,note,vel=1.0):
    tmp=tempfile.gettempdir(); pf=f'{tmp}/kickfit-{os.getpid()}.json'; out=f'{tmp}/kickfit-{os.getpid()}.wav'
    json.dump(patch,open(pf,'w'))
    subprocess.run(['node',f'{S}/render.mjs',pf,str(note),str(vel),out,os.environ.get('SECS','0.6')],check=True)
    return out
def score(ref,ours,t0,tp,ta,verbose=False):
    rt,rh,rp=ref; ot,oh,op=ours
    m=(rt>=t0)&(rt<=tp); ohz=np.interp(rt[m],ot,oh)
    pe=12*np.log2(ohz/rh[m])
    ma=(rt>=t0)&(rt<=ta)
    rn=rp/rp[rt>=t0].max(); on=op/op[ot>=t0].max()
    rdb=20*np.log10(np.maximum(rn[ma],1e-2)); odb=20*np.log10(np.maximum(np.interp(rt[ma],ot,on),1e-2))
    ae=odb-rdb
    if verbose: return np.sqrt(np.mean(pe**2)), np.sqrt(np.mean(ae**2))
    return np.mean(pe**2)+0.1*np.mean(ae**2)
