'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef, ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const dotGridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Only drive interactive spotlight on desktop
      if (window.innerWidth < 768) return;

      const el = dotGridRef.current;
      if (!el) return;

      // Use standard universally supported radial-gradient syntax
      const mask = `radial-gradient(circle at ${e.clientX}px ${e.clientY}px, black, transparent 500px)`;
      el.style.maskImage = mask;
      el.style.webkitMaskImage = mask;
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div
        ref={dotGridRef}
        className="dot-grid"
        aria-hidden="true"
      />
      {children}
    </QueryClientProvider>
  );
}
