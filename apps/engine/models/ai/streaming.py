"""Low-latency streaming wrapper around the tone-colour converter.

Microphone audio arrives in small frames. It is resampled to the model rate and cut into blocks of
``block`` samples. Each block is converted together with ``context`` samples of preceding audio
(the model is non-causal, so left context removes edge artefacts) and the output is cross-faded with
the previous block over ``crossfade`` samples. Silent blocks skip inference entirely.

Added latency ≈ block + crossfade + inference time.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import soxr
import torch

from models.ai.audio_io import dbfs
from models.ai.tone_converter import ToneColorModel
from models.ai.viseme import VisemeAnalyzer


@dataclass
class ConvertedBlock:
    seq: int
    audio: np.ndarray  # float32 at model sample rate
    visemes: np.ndarray  # (n, 4) float32
    viseme_hop_seconds: float
    input_end: int  # index (in input samples) of the source audio matching the end of ``audio``
    rtf: float  # inference seconds / block seconds
    voiced: bool


class StreamingVoiceConverter:
    # Voiced audio (model-rate seconds) after which the user's own embedding is (re)estimated.
    SOURCE_ESTIMATE_POINTS = (2.5, 7.0, 15.0)

    def __init__(
        self,
        model: ToneColorModel,
        input_sample_rate: int,
        target_se: torch.Tensor,
        source_se: torch.Tensor | None,
        fallback_source_se: torch.Tensor,
        block_ms: int,
        context_ms: int,
        crossfade_ms: int,
        silence_dbfs: float,
    ) -> None:
        self.model = model
        self.sr = model.sample_rate
        hop = model.hop_length
        self.input_sr = input_sample_rate
        self.block = max(hop * 4, int(self.sr * block_ms / 1000) // hop * hop)
        self.context = max(hop * 2, int(self.sr * context_ms / 1000) // hop * hop)
        self.crossfade = min(self.block // 2, max(64, int(self.sr * crossfade_ms / 1000)))
        self.silence_dbfs = silence_dbfs

        self.resampler = soxr.ResampleStream(input_sample_rate, self.sr, 1, dtype="float32", quality="HQ")
        self.pending = np.zeros(0, dtype=np.float32)
        self.history = np.zeros(self.context, dtype=np.float32)
        self.prev_tail = np.zeros(self.crossfade, dtype=np.float32)
        fade = np.linspace(0.0, 1.0, self.crossfade, dtype=np.float32)
        self.fade_in = np.sqrt(fade)
        self.fade_out = np.sqrt(1.0 - fade)

        self.target_se = target_se
        self.calibrated = source_se is not None
        self.source_se = source_se if source_se is not None else fallback_source_se
        self.voiced_pool: list[np.ndarray] = []
        self.voiced_seconds = 0.0
        self._next_estimate = 0

        self.visemes = VisemeAnalyzer(self.sr, hop=hop, frame=hop * 2)
        self.processed = 0  # model-rate samples consumed from ``pending``
        self.seq = 0
        self.dropped_blocks = 0
        self.was_voiced = False
        self._discontinuity = False

    # ------------------------------------------------------------------ input
    @property
    def block_seconds(self) -> float:
        return self.block / self.sr

    @property
    def source_ready(self) -> bool:
        """True once the user's own voice embedding is known (calibrated or estimated from live speech)."""
        return self.calibrated or self._next_estimate > 0

    @property
    def latency_estimate_ms(self) -> float:
        return (self.block + self.crossfade) / self.sr * 1000

    def feed_pcm16(self, payload: bytes) -> None:
        samples = np.frombuffer(payload, dtype="<i2").astype(np.float32) / 32768.0
        if samples.size:
            resampled = self.resampler.resample_chunk(samples)
            if resampled.size:
                self.pending = np.concatenate([self.pending, resampled])

    def blocks_ready(self) -> int:
        return len(self.pending) // self.block

    def drop_backlog(self, keep_blocks: int = 1) -> int:
        """Skip queued audio when the CPU falls behind so latency stays bounded."""
        excess = self.blocks_ready() - keep_blocks
        if excess <= 0:
            return 0
        cut = excess * self.block
        skipped = self.pending[:cut]
        self.pending = self.pending[cut:]
        self.history = np.concatenate([self.history, skipped])[-self.context :]
        self.processed += cut
        self._discontinuity = True  # render() fades instead of cross-fading across the gap
        self.dropped_blocks += excess
        return excess

    def set_target(self, target_se: torch.Tensor) -> None:
        self.target_se = target_se

    # ------------------------------------------------------------------ processing
    def _maybe_estimate_source(self, block: np.ndarray) -> None:
        if self.calibrated or self._next_estimate >= len(self.SOURCE_ESTIMATE_POINTS):
            return
        self.voiced_pool.append(block.copy())
        self.voiced_seconds += len(block) / self.sr
        if self.voiced_seconds >= self.SOURCE_ESTIMATE_POINTS[self._next_estimate]:
            audio = np.concatenate(self.voiced_pool)
            self.source_se = self.model.extract_embedding(audio)
            self._next_estimate += 1
            if self._next_estimate >= len(self.SOURCE_ESTIMATE_POINTS):
                self.voiced_pool.clear()

    def take_block(self) -> tuple[np.ndarray, np.ndarray, int] | None:
        """Cut the next block (event-loop thread). Returns (block, window, processed_after)."""
        if self.blocks_ready() == 0:
            return None
        block = self.pending[: self.block].copy()
        self.pending = self.pending[self.block :]
        window = np.concatenate([self.history, block])
        self.history = window[-self.context :]
        self.processed += self.block
        return block, window, self.processed

    def render(self, taken: tuple[np.ndarray, np.ndarray, int]) -> ConvertedBlock:
        """Run inference for a block from :meth:`take_block` (worker thread, called sequentially)."""
        block, window, processed = taken
        if self._discontinuity:
            self._discontinuity = False
            self.prev_tail[:] = 0
        voiced = dbfs(block) > self.silence_dbfs
        started = time.perf_counter()
        if voiced or self.was_voiced:
            if voiced:
                self._maybe_estimate_source(block)
            converted = self.model.convert(window, self.source_se, self.target_se)
            start = self.context - self.crossfade
            segment = converted[start : start + self.block + self.crossfade]
            if len(segment) < self.block + self.crossfade:  # defensive: pad if the model returned fewer samples
                segment = np.pad(segment, (0, self.block + self.crossfade - len(segment)))
            out = segment[: self.block].copy()
            out[: self.crossfade] = self.prev_tail * self.fade_out + out[: self.crossfade] * self.fade_in
            self.prev_tail = segment[self.block :].copy()
            if not voiced:  # trailing block after speech: let the tail decay to silence
                self.prev_tail *= 0
        else:
            out = np.zeros(self.block, dtype=np.float32)
            out[: self.crossfade] = self.prev_tail * self.fade_out
            self.prev_tail[:] = 0
        elapsed = time.perf_counter() - started
        self.was_voiced = voiced

        visemes = self.visemes.analyse(out)
        input_end = int(round((processed - self.crossfade) * self.input_sr / self.sr))
        self.seq += 1
        return ConvertedBlock(
            seq=self.seq,
            audio=np.clip(out, -1.0, 1.0).astype(np.float32),
            visemes=visemes,
            viseme_hop_seconds=self.visemes.hop_seconds,
            input_end=input_end,
            rtf=elapsed / self.block_seconds,
            voiced=voiced,
        )

    def process_next(self) -> ConvertedBlock | None:
        taken = self.take_block()
        return self.render(taken) if taken else None
