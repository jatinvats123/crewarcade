'use client';

// [Report a bug] inside the player (Phase 5): what went wrong + an optional phone screenshot.
// Glitch posts it as a BugCard in the game room and tries to reproduce it on camera.
import { LIMITS } from '@crewarcade/shared';
import { useId, useRef, useState } from 'react';
import { Button, useToast } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { compressImage } from '@/lib/media';

const readDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export function BugReportPanel({ gameId, version, onClose }: { gameId: string; version: number; onClose: () => void }) {
  const toast = useToast();
  const ids = { text: useId() };
  const [text, setText] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const small = await compressImage(f);
      if (!/^image\/(png|jpeg|webp)$/.test(small.type)) throw new Error('type');
      const url = await readDataUrl(small);
      if (url.length > (LIMITS.screenshotBytes * 4) / 3) throw new Error('size');
      setShot(url);
    } catch {
      toast('That photo did not work. Try a PNG or JPEG screenshot.', 'info');
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      await api.reportBug(gameId, { description: text.trim(), version, ...(shot && { screenshot: shot }) });
      toast('Sent! Glitch will try to reproduce it in the game room.', 'success');
      onClose();
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't send that. Check your connection.", 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-label="Report a bug">
      <div className="w-full max-w-md rounded-3xl bg-surface p-4 text-text shadow-card">
        <h2 className="font-display text-lg font-bold">🐞 Report a bug</h2>
        <p className="mt-1 text-sm text-dim">What did you do, and what went wrong? Glitch will try to make it happen on camera.</p>
        <label htmlFor={ids.text} className="sr-only">
          What went wrong
        </label>
        <textarea
          id={ids.text}
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={LIMITS.bugChars}
          rows={4}
          placeholder="e.g. I held right against the wall and the snowmen never hit me"
          className="mt-3 w-full resize-none rounded-2xl border border-border bg-surface-2 px-3 py-2 text-base focus:border-brand focus:outline-none"
          data-testid="bug-text"
        />
        <div className="mt-2 flex items-center gap-2">
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="ghost" onClick={() => file.current?.click()}>
            📷 {shot ? 'Change screenshot' : 'Add a screenshot'}
          </Button>
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview (data URL) */}
          {shot && <img src={shot} alt="Screenshot to send" className="h-10 rounded-lg border border-border" />}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} loading={busy} disabled={text.trim().length < 3} data-testid="bug-send">
            Send to Glitch
          </Button>
        </div>
      </div>
    </div>
  );
}
