import numpy as np, scipy.io.wavfile as wf, scipy.signal as ss, glob, re, sys, os
def load(f):
    sr,x=wf.read(f); x=x.astype(np.float64)
    if x.ndim>1: x=x.mean(1)
    if np.issubdtype(x.dtype,np.integer) or np.abs(x).max()>2: x/= (2**31 if np.abs(x).max()>2**16 else 2**15)
    return sr,x
def onset(x):
    t=np.abs(x).max()*0.01
    return int(np.argmax(np.abs(x)>t))
def analyse(f):
    sr,x=load(f); x=x[max(0,onset(x)-2):]; x=x/np.abs(x).max()  # peak-normalised
    ms=lambda m:int(m*sr/1000)
    # envelope: 1 ms peak windows
    env=np.array([np.abs(x[ms(i):ms(i+1)]).max() if ms(i+1)<=len(x) else 0 for i in range(0,400)])
    tpk=np.argmax(env)
    def tdb(d):
        idx=np.where(env>10**(d/20))[0]; return idx[-1] if len(idx) else 0
    sos=ss.butter(4,1000,'hp',fs=sr,output='sos'); h=ss.sosfilt(sos,x)
    click=np.abs(h[:ms(5)]).max()
    hiE=np.sum(h[:ms(20)]**2)/np.sum(x[:ms(20)]**2)
    # pitch: zero crossings of LP'd signal -> half-period freqs
    lp=ss.sosfilt(ss.butter(2,600,'lp',fs=sr,output='sos'),x)
    zc=np.where(np.diff(np.signbit(lp)))[0]
    zt=zc/sr*1000
    f=[(zt[i]+zt[i+1])/2 for i in range(len(zt)-1)]; hz=[500/(zt[i+1]-zt[i]) for i in range(len(zt)-1)]
    def hz_at(t):
        for a,b in zip(f,hz):
            if a>=t: return b
        return float('nan')
    first_sign = 1 if x[np.argmax(np.abs(x[:ms(3)])>0.2)]>0 else -1
    return dict(sr=sr,len=len(x)/sr*1000,tpk=tpk,t20=tdb(-20),t40=tdb(-40),click=click,hiE=hiE,
                f2=hz_at(1.5),f5=hz_at(5),f10=hz_at(10),f20=hz_at(20),f40=hz_at(40),f80=hz_at(80),fend=np.nanmedian(hz[-6:-1]) if len(hz)>8 else np.nan,
                env=env, first=first_sign, x=x)
def row(name,a):
    return f"{name:34s} pk@{a['tpk']:2d}ms -20dB@{a['t20']:3d} -40dB@{a['t40']:3d}  click>1k {a['click']:.2f} hiE20 {100*a['hiE']:5.2f}%  Hz@1.5/5/10/20/40/80ms {a['f2']:4.0f} {a['f5']:4.0f} {a['f10']:4.0f} {a['f20']:4.0f} {a['f40']:4.0f} {a['f80']:4.0f} end {a['fend']:4.0f}  env0-8ms {' '.join(f'{v:.2f}' for v in a['env'][:8])}"
if __name__=='__main__':
    for f in sys.argv[1:]: print(row(os.path.basename(f)[:34].replace('.wav',''),analyse(f)))
