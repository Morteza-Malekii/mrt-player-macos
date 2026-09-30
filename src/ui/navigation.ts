import { useEffect } from 'react';
export function useRemote(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const direction = ({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' } as Record<number, string>)[event.keyCode] || ({ ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down' } as Record<string, string>)[event.key];
      if (!direction || event.defaultPrevented) return;
      const active = document.activeElement as HTMLElement;
      const horizontal = direction === 'left' || direction === 'right';
      if ((active instanceof HTMLInputElement && (active.type === 'range' || (horizontal && !['checkbox', 'radio', 'button'].includes(active.type)))) || (active instanceof HTMLSelectElement && !horizontal)) return;
      if (active?.getAttribute('aria-label') === 'Program listesi' && !horizontal) {
        const delta = direction === 'down' ? 130 : -130;
        if ((delta > 0 && active.scrollTop + active.clientHeight < active.scrollHeight - 2) || (delta < 0 && active.scrollTop > 0)) { event.preventDefault(); active.scrollTop += delta; return; }
      }
      const scope = document.querySelector('[role="dialog"]') || document.querySelector('.player-full') || document;
      const candidates = Array.from(scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(e => e.offsetWidth > 0 && e.offsetHeight > 0 && !e.closest('[inert]'));
      if (!candidates.length) return;
      event.preventDefault();
      if (!candidates.includes(active)) { candidates[0].focus(); return; }
      const box = active.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      let next: HTMLElement | undefined, score = Infinity;
      for (const candidate of candidates) {
        if (candidate === active) continue;
        const r = candidate.getBoundingClientRect(), dx = r.x + r.width / 2 - x, dy = r.y + r.height / 2 - y;
        const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
        if (primary <= 2) continue;
        const cross = Math.abs(horizontal ? dy : dx), s = primary + cross * 3 + cross * cross / Math.max(primary, 1);
        if (s < score) { score = s; next = candidate; }
      }
      next?.focus(); next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const pointer = (event: MouseEvent) => { const target = (event.target as HTMLElement).closest<HTMLElement>('button,input,select'); if (target && document.activeElement !== target) target.focus({ preventScroll: true }); };
    document.addEventListener('keydown', onKey); document.addEventListener('mouseover', pointer);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mouseover', pointer); };
  }, [enabled]);
}
