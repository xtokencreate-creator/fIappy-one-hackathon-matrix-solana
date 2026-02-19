import { useEffect, useState } from 'react';

const getIsMobilePortrait = () => {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const portrait = window.innerHeight > window.innerWidth;
  const narrow = window.innerWidth <= 520;
  return portrait && (coarse || narrow);
};

export default function useIsMobilePortrait() {
  const [isMobilePortrait, setIsMobilePortrait] = useState(getIsMobilePortrait);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let rafId = 0;
    let timeoutId = 0;

    const scheduleUpdate = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
      rafId = requestAnimationFrame(() => {
        timeoutId = setTimeout(() => {
          setIsMobilePortrait(getIsMobilePortrait());
        }, 120);
      });
    };

    const viewport = window.visualViewport;
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', scheduleUpdate);
    viewport?.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', scheduleUpdate);
      viewport?.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  return isMobilePortrait;
}
