import { useEffect, useState } from 'react';

export function AnimatedSprite({ frames, fps = 8, className, alt = '' }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [frames]);

  useEffect(() => {
    if (!Array.isArray(frames) || frames.length <= 1 || fps <= 0) return undefined;
    if (typeof window !== 'undefined') {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (reduced) return undefined;
    }
    const intervalMs = 1000 / fps;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [frames, fps]);

  const src = frames?.[frameIndex] || frames?.[0] || '';
  return <img src={src} alt={alt} className={className} draggable={false} loading="eager" />;
}

export default AnimatedSprite;
