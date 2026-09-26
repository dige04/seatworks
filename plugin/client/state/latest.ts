import { useRef } from "react";

/** The newest `value` a render was handed, for an effect that must not run again each render for a new function. */
export function useLatest<T>(value: T): { readonly current: T } {
  const latest = useRef(value);
  latest.current = value;
  return latest;
}
