'use client';

import { useEffect } from 'react';
import { logError } from '@dripl/common';

export function SWRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV !== 'development') {
      navigator.serviceWorker.register('/sw.js').catch(logError);
    }
  }, []);

  return null;
}
