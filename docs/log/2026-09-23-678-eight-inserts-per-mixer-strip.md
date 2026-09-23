# Eight inserts per mixer track and song master

Ticket #678 follows Pat's report that a chorus plus compressor disables Add
insert. The two-stage cap from #641 was a bounded-allocation policy; the
chain and shared track/master editor already accept longer lists.

Raise the shared `MAX_INSERTS` to eight. Eight is the implementation choice
proposed to Pat, retaining a finite per-strip allocation cap while allowing
longer chains. There is no change to DSP, routing, ordering or sidechains.
The same value controls the picker, document normalisation and live apply;
a ninth valid insert is still dropped and reported. Existing shorter songs
remain unchanged. The master shares this policy, amending #666's two-insert
limit.

This is a capacity choice, not a measured CPU budget. Native insert work is
not fully represented by worklet load counters; target-machine audio cost
remains a separate milestone reading. Browser evidence demonstrates the
controls and sound path, not a worst-case performance guarantee.
