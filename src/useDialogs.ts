import { useEffect } from 'react';

export function useDialogs() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    let restore: HTMLElement | null = null;
    let lastOutside: HTMLElement | null = document.activeElement as HTMLElement;
    const disabled = new Set<HTMLElement>();
    const restoreBackground = () => { disabled.forEach(el => { el.inert = false; }); disabled.clear(); };
    const getDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1) || null;
    const focusables = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length > 0);
    const sync = () => {
      const dialog = getDialog();
      if (dialog === active) return;
      if (dialog && !active) restore = lastOutside;
      active = dialog;
      restoreBackground();
      if (dialog) {
        let branch: HTMLElement = dialog;
        while (branch.parentElement) {
          for (const sibling of branch.parentElement.children) {
            if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
              sibling.inert = true; disabled.add(sibling);
            }
          }
          branch = branch.parentElement;
          if (branch === document.body) break;
        }
      }
      if (dialog) { if (!dialog.contains(document.activeElement)) focusables(dialog)[0]?.focus(); }
      else if (restore?.isConnected) { restore.focus(); restore = null; }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const onFocus = (event: FocusEvent) => { if (!getDialog()) lastOutside = event.target as HTMLElement; };
    const onKey = (event: KeyboardEvent) => {
      const dialog = getDialog(); if (!dialog) return;
      if (event.key === 'Tab') {
        const items = focusables(dialog), first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        const close = dialog.querySelector<HTMLButtonElement>('button[aria-label^="关闭"]') || [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(b => ['取消', '再留一会儿'].includes(b.textContent?.trim() || ''));
        close?.click();
      }
    };
    document.addEventListener('focusin', onFocus);
    window.addEventListener('keydown', onKey, true);
    sync();
    return () => { observer.disconnect(); document.removeEventListener('focusin', onFocus); window.removeEventListener('keydown', onKey, true); restoreBackground(); };
  }, []);
}
