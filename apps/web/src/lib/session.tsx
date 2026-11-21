'use client';

// Who is signed in (guest identity from the session cookie). The cookie is httpOnly; the browser
// learns the user only through GET /api/me.
import type { Profile } from '@crewarcade/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError } from './api';
import { tourEnabledFor } from './tour/steps';
import { setTourUser } from './tour/store';

export type SessionStatus = 'loading' | 'anonymous' | 'ready' | 'error';

interface SessionValue {
  status: SessionStatus;
  user: Profile | null;
  setUser: (u: Profile) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<Profile | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  const refresh = useCallback(async () => {
    try {
      setUserState(await api.me());
      setStatus('ready');
    } catch (e) {
      setUserState(null);
      setStatus(e instanceof ApiRequestError && e.status === 401 ? 'anonymous' : 'error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The judge tour is on for judges only; anyone else signed in (or signed out) turns it off here.
  useEffect(() => {
    if (status === 'ready') setTourUser(tourEnabledFor(user) ? user!.id : null);
    else if (status === 'anonymous') setTourUser(null);
  }, [status, user]);

  const setUser = useCallback((u: Profile) => {
    setUserState(u);
    setStatus('ready');
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => {});
    setUserState(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo(() => ({ status, user, setUser, refresh, signOut }), [status, user, setUser, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
