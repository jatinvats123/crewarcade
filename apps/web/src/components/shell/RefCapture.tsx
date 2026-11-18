'use client';

import { useEffect } from 'react';
import { captureRef } from '@/lib/ref';

/** Keeps the first `?ref=` code a visitor arrives with (see lib/ref.ts). Renders nothing. */
export function RefCapture() {
  useEffect(() => captureRef(window.location.search), []);
  return null;
}
