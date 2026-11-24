"""Audio-driven lip-sync: estimates mouth shapes from the *converted* voice.

Each hop (the model's 256-sample STFT hop, ~11.6 ms at 22.05 kHz) yields four normalised channels:
  jaw    - mouth opening (open vowels such as "a" drive it hardest)
  round  - lip rounding / pucker ("o", "u", "w": low spectral centroid)
  wide   - lip spreading ("i", "e", sibilants: high centroid / fricative energy)
  energy - voiced loudness, used for gating and subtle head/brow emphasis

The estimate uses short-time spectra (band energies around the first two formant regions and the
spectral centroid), smoothed with separate attack and release constants so the mouth opens quickly
and closes naturally.
"""
from __future__ import annotations

import numpy as np


class VisemeAnalyzer:
    CHANNELS = 4

    def __init__(self, sample_rate: int, hop: int = 256, frame: int = 512) -> None:
        # ``hop`` must divide the streaming block size so the viseme timeline never drifts.
        self.sr = sample_rate
        self.hop = hop
        self.frame = max(hop, frame)
        self.window = np.hanning(self.frame).astype(np.float32)
        freqs = np.fft.rfftfreq(self.frame, 1.0 / sample_rate)
        self.freqs = freqs
        self.band_speech = (freqs >= 80) & (freqs < 8000)
        self.band_low = (freqs >= 250) & (freqs < 950)
        self.band_mid = (freqs >= 950) & (freqs < 2000)
        self.band_high = (freqs >= 2000) & (freqs < 4000)
        self.band_fric = (freqs >= 4000) & (freqs < 8000)
        self.state = np.zeros(self.CHANNELS, dtype=np.float32)
        self.tail = np.zeros(0, dtype=np.float32)
        # Adaptive loudness reference so quiet and loud speakers both reach full range.
        self.loud_ref = -24.0

    @property
    def hop_seconds(self) -> float:
        return self.hop / self.sr

    def reset(self) -> None:
        self.state[:] = 0
        self.tail = np.zeros(0, dtype=np.float32)

    def analyse(self, audio: np.ndarray) -> np.ndarray:
        """Return an (n_hops, 4) float32 array covering exactly ``len(audio) // hop`` hops."""
        n_hops = len(audio) // self.hop
        out = np.zeros((n_hops, self.CHANNELS), dtype=np.float32)
        if n_hops == 0:
            return out
        # Prepend the tail of the previous block so frames are centred correctly across blocks.
        pad = self.frame - self.hop
        history = self.tail if len(self.tail) == pad else np.zeros(pad, dtype=np.float32)
        signal = np.concatenate([history, audio.astype(np.float32, copy=False)])
        self.tail = signal[len(signal) - pad :].copy() if pad > 0 else np.zeros(0, dtype=np.float32)

        idx = np.arange(self.frame)[None, :] + (np.arange(n_hops) * self.hop)[:, None]
        frames = signal[idx] * self.window
        power = np.abs(np.fft.rfft(frames, axis=1)) ** 2 + 1e-12

        total = power[:, self.band_speech].sum(axis=1)
        low = power[:, self.band_low].sum(axis=1) / total
        high = power[:, self.band_high].sum(axis=1) / total
        fric = power[:, self.band_fric].sum(axis=1) / total
        centroid = (power[:, self.band_speech] * self.freqs[self.band_speech]).sum(axis=1) / total

        rms = np.sqrt((frames**2).mean(axis=1) / (self.window**2).mean() + 1e-12)
        db = 20 * np.log10(rms + 1e-9)
        peak = float(db.max())
        if peak > -45:
            self.loud_ref = max(-40.0, 0.97 * self.loud_ref + 0.03 * peak) if peak < self.loud_ref else 0.7 * self.loud_ref + 0.3 * peak
        energy = np.clip((db - (self.loud_ref - 30.0)) / 28.0, 0.0, 1.0)

        jaw = energy**0.85 * (0.35 + 0.65 * np.clip(low * 1.6, 0, 1)) * (1 - 0.65 * np.clip(fric * 2.0, 0, 1))
        round_ = energy * np.clip((1250.0 - centroid) / 750.0, 0, 1) * np.clip(1 - high * 2.5, 0, 1)
        wide = energy * np.clip(np.clip((centroid - 1500.0) / 1600.0, 0, 1) * 0.7 + np.clip(fric * 2.0, 0, 1) * 0.5, 0, 1)
        targets = np.stack([jaw, round_, wide, energy], axis=1).astype(np.float32)

        attack = np.array([0.65, 0.5, 0.5, 0.7], dtype=np.float32)
        release = np.array([0.28, 0.22, 0.22, 0.25], dtype=np.float32)
        state = self.state
        for i in range(n_hops):
            target = targets[i]
            rate = np.where(target > state, attack, release)
            state = state + (target - state) * rate
            out[i] = state
        self.state = state.astype(np.float32)
        return out
