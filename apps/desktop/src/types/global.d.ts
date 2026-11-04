import type { AvcApi } from '../../electron/preload';

declare global {
  interface Window {
    /** Exposed by the preload script via contextBridge. Undefined in a plain browser. */
    avc?: AvcApi;
  }
}
export {};
