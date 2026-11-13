'use client';

// The signed-in user's crews (GET /api/crews) and crew details (members + roles), cached per crew.
import type { CrewDetail, CrewSummary } from '@crewarcade/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useSession } from './session';

interface CrewsValue {
  crews: CrewSummary[] | null;
  error: string | null;
  refresh: () => Promise<void>;
  details: Record<string, CrewDetail>;
  loadDetail: (id: string, force?: boolean) => Promise<CrewDetail | null>;
  upsert: (d: CrewDetail) => void;
  byChannel: (channelId: string) => CrewSummary | undefined;
}

const CrewsContext = createContext<CrewsValue | null>(null);

export function CrewsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, CrewDetail>>({});
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(new Map<string, Promise<CrewDetail | null>>());

  const refresh = useCallback(async () => {
    try {
      setCrews(await api.crews());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (status === 'ready') void refresh();
    if (status === 'anonymous') {
      setCrews(null);
      setDetails({});
    }
  }, [status, refresh]);

  const upsert = useCallback((d: CrewDetail) => {
    setDetails(prev => ({ ...prev, [d.id]: d }));
    setCrews(prev => {
      const { members: _m, ownerId: _o, ...summary } = d;
      if (!prev) return [summary];
      return prev.some(c => c.id === d.id) ? prev.map(c => (c.id === d.id ? { ...summary, role: d.role } : c)) : [...prev, summary];
    });
  }, []);

  const detailsRef = useRef(details);
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);
  const loadDetail = useCallback(
    async (id: string, force = false) => {
      if (!force && detailsRef.current[id]) return detailsRef.current[id]!;
      const pending = inflight.current.get(id);
      if (pending) return pending;
      const p = api
        .crew(id)
        .then(d => {
          upsert(d);
          return d;
        })
        .catch(() => null)
        .finally(() => inflight.current.delete(id));
      inflight.current.set(id, p);
      return p;
    },
    [upsert],
  );

  const byChannel = useCallback((channelId: string) => crews?.find(c => c.groupChannelId === channelId), [crews]);

  const value = useMemo(
    () => ({ crews, error, refresh, details, loadDetail, upsert, byChannel }),
    [crews, error, refresh, details, loadDetail, upsert, byChannel],
  );
  return <CrewsContext.Provider value={value}>{children}</CrewsContext.Provider>;
}

export function useCrews(): CrewsValue {
  const ctx = useContext(CrewsContext);
  if (!ctx) throw new Error('useCrews must be used inside <CrewsProvider>');
  return ctx;
}
