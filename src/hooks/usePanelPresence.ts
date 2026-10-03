import { useLayoutEffect, useState } from 'react';

/** Keep the surface through exit; a reversal cancels the pending close instead of queuing it. */
export function usePanelPresence(open: boolean) {
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>(open ? 'entering' : 'closing');
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let timer = 0;
    if (open) {
      setPresent(true);
      if (reduced || (present && phase === 'closing')) setPhase('open');
      else { setPhase('entering'); frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(() => setPhase('open')); }); }
    } else {
      setPhase('closing');
      if (reduced) setPresent(false);
      else timer = window.setTimeout(() => setPresent(false), 220);
    }
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [open]);
  return { present, phase };
}
