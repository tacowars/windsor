import numpy as np, scipy.signal as ss
from ana import load, onset
from fit import cyc, score
EDGE={'on':False}
def wav(f, is_ref=False):
    sr,x=load(f); x=x[max(0,onset(x)-2):].astype(float)
    if EDGE['on'] and is_ref:
        i=int(np.argmax(np.abs(x)>0.5*np.abs(x).max())); x=x[max(0,i-int(sr*EDGE.get('pre',0.0015))):]
    if sr!=48000: x=ss.resample_poly(x,48000,sr)
    return x/np.abs(x).max()
def wscore(ref_f, ours_f, t0,tp,ta, W=30, verbose=False):
    r=wav(ref_f, True); o=wav(ours_f); n=int(W*48)
    hpf=ss.butter(4,1000,'hp',fs=48000,output='sos')
    best=1e9; bl=0
    for lag in range(0,int(3*48)):   # ref may start later than ours
        e=np.mean((r[lag:lag+n]-o[:n])**2)
        if e<best: best,bl=e,lag
    rh=ss.sosfilt(hpf,r)[bl:bl+int(10*48)]; oh=ss.sosfilt(hpf,o)[:int(10*48)]
    # click: compare HF RMS in 1-ms bins
    rb=np.sqrt(np.mean(rh.reshape(10,-1)**2,1)); ob=np.sqrt(np.mean(oh.reshape(10,-1)**2,1))
    ce=np.mean((20*np.log10(ob+1e-3)-20*np.log10(rb+1e-3))**2)
    cs=score(cyc(ref_f),cyc(ours_f),t0,tp,ta)
    if verbose: return dict(wave_mse=best, lag_ms=bl/48, click_db_rms=np.sqrt(ce), cyc=score(cyc(ref_f),cyc(ours_f),t0,tp,ta,verbose=True))
    return 20*best + 0.02*ce + cs
