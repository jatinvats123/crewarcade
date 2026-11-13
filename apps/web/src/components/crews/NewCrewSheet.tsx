'use client';

import { CrewName } from '@crewarcade/shared';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { useCrews } from '@/lib/crews';

export function NewCrewSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { upsert } = useCrews();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = CrewName.safeParse(name);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Pick a name');
    setBusy(true);
    setError(null);
    try {
      const crew = await api.createCrew({ name: parsed.data });
      upsert(crew);
      setName('');
      onClose();
      router.push(`/crews/${crew.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New crew">
      <form onSubmit={submit} className="flex flex-col gap-3 pb-2">
        <p className="text-sm text-dim">Pixel, Forge and Glitch join every crew. You can invite friends right after.</p>
        <label htmlFor={id} className="text-sm font-semibold">
          Crew name
        </label>
        <input
          id={id}
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          placeholder="e.g. Friday Game Night"
          enterKeyHint="done"
          className="min-h-12 rounded-2xl border border-border bg-surface px-4 text-base placeholder:text-faint focus:border-brand focus:outline-none"
          aria-invalid={!!error}
        />
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={busy}>
          Create crew
        </Button>
      </form>
    </Sheet>
  );
}
