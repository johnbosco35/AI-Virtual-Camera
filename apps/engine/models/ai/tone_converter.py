"""OpenVoice V2 tone-colour converter: real speech-to-speech voice conversion.

The converter keeps the words, rhythm and intonation of the source speech and replaces the speaker's
timbre with the target embedding. It is zero-shot: a target voice needs only a short sample
(``extract_embedding``), not a training run.
"""
from __future__ import annotations

import logging
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch

from config.settings import get_settings

log = logging.getLogger("engine.converter")

CONVERTER_FILES = ["converter/config.json", "converter/checkpoint.pth"]
BASE_SPEAKERS = ["en-us", "en-br", "en-au", "en-india", "en-default", "en-newest", "es", "fr", "jp", "kr", "zh"]
BASE_SPEAKER_FILES = [f"base_speakers/ses/{name}.pth" for name in BASE_SPEAKERS]


@dataclass
class ModelState:
    state: str = "missing"  # missing | downloading | loading | ready | error
    detail: str = ""
    progress: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)


class ToneColorModel:
    """Process-wide owner of the OpenVoice converter weights."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.status = ModelState()
        self.model = None
        self.hps = None
        self.device = "cpu"
        self.sample_rate = 22050
        self.hop_length = 256
        # Inference is not re-entrant on one module; serialise calls from concurrent sessions.
        self.infer_lock = threading.Lock()
        if not self.files_present():
            self.status.detail = "AI voice model files are not downloaded yet."

    # ------------------------------------------------------------------ files
    @property
    def root(self) -> Path:
        return self.settings.checkpoints_dir / "openvoice_v2"

    def files_present(self) -> bool:
        return all((self.root / rel).is_file() and (self.root / rel).stat().st_size > 0 for rel in CONVERTER_FILES + BASE_SPEAKER_FILES)

    def base_speaker_path(self, name: str) -> Path:
        return self.root / "base_speakers" / "ses" / f"{name}.pth"

    def download(self) -> None:
        """Fetch the MIT-licensed OpenVoice V2 converter weights from Hugging Face (user-initiated)."""
        with self.status.lock:
            if self.status.state in {"downloading", "loading"}:
                return
            self.status.state, self.status.detail, self.status.progress = "downloading", "Downloading OpenVoice V2…", 0.0
        try:
            files = CONVERTER_FILES + BASE_SPEAKER_FILES
            for index, rel in enumerate(files):
                target = self.root / rel
                if target.is_file() and target.stat().st_size > 0:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                url = f"https://huggingface.co/{self.settings.hf_repo}/resolve/main/{rel}"
                partial = target.with_suffix(target.suffix + ".part")
                with urllib.request.urlopen(url, timeout=60) as response, open(partial, "wb") as handle:
                    total = int(response.headers.get("Content-Length") or 0)
                    done = 0
                    while chunk := response.read(1 << 16):
                        handle.write(chunk)
                        done += len(chunk)
                        file_fraction = done / total if total else 0.0
                        self.status.progress = (index + file_fraction) / len(files)
                        self.status.detail = f"Downloading {rel} ({done // (1 << 20)} MB)"
                partial.replace(target)
            self.status.progress = 1.0
        except Exception as exc:
            log.exception("Model download failed")
            self.status.state, self.status.detail = "error", f"Download failed: {exc}"
            return
        self.status.state = "missing"
        self.load()

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        if not self.files_present():
            self.status.state, self.status.detail = "missing", "AI voice model files are not downloaded yet."
            return
        with self.status.lock:
            if self.status.state in {"loading", "ready"}:
                return
            self.status.state, self.status.detail = "loading", "Loading OpenVoice V2 converter…"
        try:
            from openvoice import utils
            from openvoice.models import SynthesizerTrn

            wanted = self.settings.device
            self.device = "cuda" if wanted in {"auto", "cuda"} and torch.cuda.is_available() else "cpu"
            torch.set_num_threads(self.settings.resolved_threads())
            hps = utils.get_hparams_from_file(str(self.root / "converter" / "config.json"))
            model = SynthesizerTrn(
                len(getattr(hps, "symbols", [])),
                hps.data.filter_length // 2 + 1,
                n_speakers=hps.data.n_speakers,
                **hps.model,
            ).to(self.device)
            checkpoint = torch.load(self.root / "converter" / "checkpoint.pth", map_location=self.device, weights_only=False)
            model.load_state_dict(checkpoint["model"], strict=False)
            model.eval()
            # Weight-norm reparametrisation is only needed for training; removing it speeds up inference.
            try:
                model.dec.remove_weight_norm()
            except Exception:  # pragma: no cover - older module layouts
                pass
            self.model, self.hps = model, hps
            self.sample_rate = int(hps.data.sampling_rate)
            self.hop_length = int(hps.data.hop_length)
            self.status.state, self.status.detail = "ready", f"OpenVoice V2 ready on {self.device.upper()}"
            log.info("Converter loaded on %s with %d threads", self.device, torch.get_num_threads())
        except Exception as exc:
            log.exception("Model load failed")
            self.status.state, self.status.detail = "error", f"Model failed to load: {exc}"

    @property
    def ready(self) -> bool:
        return self.status.state == "ready" and self.model is not None

    def require_ready(self) -> None:
        if not self.ready:
            raise RuntimeError(self.status.detail or "The voice model is not ready.")

    # ------------------------------------------------------------------ inference
    def _spectrogram(self, audio: np.ndarray) -> torch.Tensor:
        from openvoice.mel_processing import spectrogram_torch

        hps = self.hps
        y = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).to(self.device).unsqueeze(0)
        return spectrogram_torch(y, hps.data.filter_length, hps.data.sampling_rate, hps.data.hop_length, hps.data.win_length, center=False)

    def extract_embedding(self, audio: np.ndarray, segment_seconds: float = 8.0) -> torch.Tensor:
        """Tone-colour embedding (1, 256, 1) from mono audio at ``sample_rate``. Long samples are averaged over segments."""
        self.require_ready()
        segment = int(segment_seconds * self.sample_rate)
        pieces = [audio[i : i + segment] for i in range(0, len(audio), segment)]
        pieces = [p for p in pieces if len(p) >= self.sample_rate] or [audio]
        embeddings = []
        with self.infer_lock, torch.inference_mode():
            for piece in pieces:
                spec = self._spectrogram(piece)
                embeddings.append(self.model.ref_enc(spec.transpose(1, 2)).unsqueeze(-1))
        return torch.stack(embeddings).mean(0).cpu()

    def convert(self, audio: np.ndarray, source_se: torch.Tensor, target_se: torch.Tensor, tau: float | None = None) -> np.ndarray:
        """Convert mono float32 audio (at ``sample_rate``, length a multiple of ``hop_length``)."""
        self.require_ready()
        tau = self.settings.tau if tau is None else tau
        with self.infer_lock, torch.inference_mode():
            spec = self._spectrogram(audio)
            lengths = torch.LongTensor([spec.size(-1)]).to(self.device)
            out = self.model.voice_conversion(spec, lengths, sid_src=source_se.to(self.device), sid_tgt=target_se.to(self.device), tau=tau)[0]
            return out[0, 0].float().cpu().numpy()

    def load_embedding(self, path: Path) -> torch.Tensor:
        return torch.load(path, map_location="cpu", weights_only=False).reshape(1, -1, 1).float()

    def save_embedding(self, embedding: torch.Tensor, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(embedding.cpu(), path)

    # ------------------------------------------------------------------ benchmark
    def benchmark(self, seconds: float = 1.0, repeats: int = 3) -> dict:
        """Measure the real-time factor (compute time / audio time) on this machine."""
        self.require_ready()
        n = int(seconds * self.sample_rate) // self.hop_length * self.hop_length
        t = np.arange(n) / self.sample_rate
        probe = (0.2 * np.sin(2 * np.pi * 180 * t) * (1 + 0.5 * np.sin(2 * np.pi * 3 * t))).astype(np.float32)
        se = self.extract_embedding(probe)
        self.convert(probe, se, se)  # warm-up
        timings = []
        for _ in range(repeats):
            started = time.perf_counter()
            self.convert(probe, se, se)
            timings.append(time.perf_counter() - started)
        rtf = float(np.median(timings) / seconds)
        return {"rtf": rtf, "window_seconds": seconds, "device": self.device, "threads": torch.get_num_threads(), "measured_at": time.time()}


tone_model = ToneColorModel()
