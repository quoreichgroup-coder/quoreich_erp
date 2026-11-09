import { useEffect, useState } from "react";

/**
 * State hook backed by localStorage. Survives reloads and navigation.
 * Pass a stable `key` per page+field. Values must be JSON-serialisable.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / private mode — silently ignore */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
