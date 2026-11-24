import { useCallback, useEffect, useState } from 'react';

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

/** Media device lists, refreshed on plug/unplug. Labels appear once permission has been granted. */
export function useDevices() {
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], microphones: [], outputs: [] });

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cameras: all.filter((d) => d.kind === 'videoinput'),
        microphones: all.filter((d) => d.kind === 'audioinput'),
        outputs: all.filter((d) => d.kind === 'audiooutput'),
      });
    } catch {
      /* media devices unavailable */
    }
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { ...devices, refresh };
}
