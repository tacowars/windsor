import sys, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt, scipy.signal as ss
from ana import load, onset
import os, wfit
wfit.EDGE['on']=os.environ.get('EDGE')=='1'
out=sys.argv[1]; rows=[a.split('|') for a in sys.argv[2:]]
fig,ax=plt.subplots(len(rows),3,figsize=(16,2.6*len(rows)))
ax=np.atleast_2d(ax)
for r,(lab,ref,ours) in enumerate(rows):
    for f,c,l in [(ref,'k','ref'),(ours,'r','ours')]:
        x=wfit.wav(f, l=='ref'); sr=48000; t=np.arange(len(x))/sr*1000
        ax[r,0].plot(t[t<30],x[t<30],c=c,lw=.8,label=l); ax[r,1].plot(t[t<400],x[t<400],c=c,lw=.4)
        h=ss.sosfilt(ss.butter(4,1000,'hp',fs=sr,output='sos'),x); ax[r,2].plot(t[t<10],h[t<10],c=c,lw=.8)
    ax[r,0].set_title(lab+' 0-30 ms',fontsize=9); ax[r,0].legend(fontsize=7); ax[r,1].set_title('0-400 ms',fontsize=9); ax[r,2].set_title('>1 kHz, 0-10 ms (click)',fontsize=9)
plt.tight_layout(); plt.savefig(out,dpi=75)
