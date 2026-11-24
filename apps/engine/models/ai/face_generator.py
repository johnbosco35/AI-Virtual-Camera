"""Neural portrait reenactment (LivePortrait, MIT): animates one portrait with the motion of live webcam crops.

This is the optional high-quality animation path. The renderer computes aligned face crops from MediaPipe
landmarks (one implementation, in the desktop app) and sends 256x256 JPEG crops; this module returns the
animated 512x512 face crop, which the renderer blends back into the portrait over its static background.

Motion is transferred *relative* to a neutral reference frame of the user (as LivePortrait's own pipeline
does): the portrait keeps its identity, pose offset and proportions, and only the change from the user's
neutral face is applied. Real-time speed needs a CUDA GPU; on a CPU it runs at about a frame per second.

Weights: https://huggingface.co/KwaiVGI/LivePortrait (MIT), downloaded on request into data/checkpoints.
"""
from __future__ import annotations

import io
import logging
import threading
import time
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from config.settings import get_settings

log = logging.getLogger("engine.face")

HF_REPO = "KwaiVGI/LivePortrait"
WEIGHTS = {
    "appearance_feature_extractor": "liveportrait/base_models/appearance_feature_extractor.pth",
    "motion_extractor": "liveportrait/base_models/motion_extractor.pth",
    "warping_module": "liveportrait/base_models/warping_module.pth",
    "spade_generator": "liveportrait/base_models/spade_generator.pth",
    "stitching_retargeting_module": "liveportrait/retargeting_models/stitching_retargeting_module.pth",
}
# From LivePortrait's src/config/models.yaml
PARAMS = {
    "appearance_feature_extractor": dict(image_channel=3, block_expansion=64, num_down_blocks=2, max_features=512, reshape_channel=32, reshape_depth=16, num_resblocks=6),
    "motion_extractor": dict(num_kp=21, backbone="convnextv2_tiny"),
    "warping_module": dict(
        num_kp=21, block_expansion=64, max_features=512, num_down_blocks=2, reshape_channel=32, estimate_occlusion_map=True,
        dense_motion_params=dict(block_expansion=32, max_features=1024, num_blocks=5, reshape_depth=16, compress=4),
    ),
    "spade_generator": dict(upscale=2, block_expansion=64, max_features=512, num_down_blocks=2),
    "stitching": dict(input_size=126, hidden_sizes=[128, 128, 64], output_size=65),
}
CROP = 256


def _weights_dir():
    return get_settings().checkpoints_dir / "liveportrait"


def weights_present() -> bool:
    root = _weights_dir()
    return all((root / rel).is_file() for rel in WEIGHTS.values())


# ---------------------------------------------------------------- LivePortrait math (src/utils/camera.py)
def headpose_pred_to_degree(pred: torch.Tensor) -> torch.Tensor:
    if pred.ndim > 1 and pred.shape[1] == 66:
        idx = torch.arange(66, dtype=torch.float32, device=pred.device)
        return torch.sum(F.softmax(pred, dim=1) * idx, dim=1) * 3 - 97.5
    return pred


def get_rotation_matrix(pitch_: torch.Tensor, yaw_: torch.Tensor, roll_: torch.Tensor) -> torch.Tensor:
    x, y, z = (a / 180 * np.pi for a in (pitch_, yaw_, roll_))
    x, y, z = (a.unsqueeze(1) if a.ndim == 1 else a for a in (x, y, z))
    bs = x.shape[0]
    one, zero = torch.ones([bs, 1], device=x.device), torch.zeros([bs, 1], device=x.device)
    rot_x = torch.cat([one, zero, zero, zero, torch.cos(x), -torch.sin(x), zero, torch.sin(x), torch.cos(x)], dim=1).reshape(bs, 3, 3)
    rot_y = torch.cat([torch.cos(y), zero, torch.sin(y), zero, one, zero, -torch.sin(y), zero, torch.cos(y)], dim=1).reshape(bs, 3, 3)
    rot_z = torch.cat([torch.cos(z), -torch.sin(z), zero, torch.sin(z), torch.cos(z), zero, zero, zero, one], dim=1).reshape(bs, 3, 3)
    return (rot_z @ rot_y @ rot_x).permute(0, 2, 1)


def _strip_ddp(state: dict) -> dict:
    return {k.replace("module.", "", 1) if k.startswith("module.") else k: v for k, v in state.items()}


@dataclass
class _Source:
    feature_3d: torch.Tensor
    kp_canonical: torch.Tensor
    info: dict
    rotation: torch.Tensor
    kp: torch.Tensor


@dataclass
class FaceGeneratorStatus:
    state: str = "missing"  # missing | downloading | loading | ready | error
    detail: str = ""
    device: str = "cpu"
    last_ms: float | None = None
    frames: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


class FaceGenerator:
    def __init__(self):
        self.status = FaceGeneratorStatus(state="unloaded" if weights_present() else "missing")
        self.models: dict | None = None
        self.device = torch.device("cpu")
        self._lock = threading.Lock()

    # ------------------------------------------------------------ lifecycle
    def download(self) -> None:
        from huggingface_hub import hf_hub_download

        self.status.state, self.status.detail = "downloading", "Downloading LivePortrait weights (~520 MB)…"
        try:
            for rel in WEIGHTS.values():
                hf_hub_download(HF_REPO, rel, local_dir=str(_weights_dir()))
            self.status.state, self.status.detail = "unloaded", "Weights downloaded."
        except Exception as error:  # noqa: BLE001
            self.status.state, self.status.detail = "error", f"Download failed: {error}"
            raise

    def load(self) -> None:
        with self._lock:
            if self.models is not None:
                return
            if not weights_present():
                raise RuntimeError("LivePortrait weights are not downloaded.")
            from models.ai.liveportrait.appearance_feature_extractor import AppearanceFeatureExtractor
            from models.ai.liveportrait.motion_extractor import MotionExtractor
            from models.ai.liveportrait.spade_generator import SPADEDecoder
            from models.ai.liveportrait.stitching_retargeting_network import StitchingRetargetingNetwork
            from models.ai.liveportrait.warping_network import WarpingNetwork

            self.status.state, self.status.detail = "loading", "Loading LivePortrait…"
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            root = _weights_dir()

            def load(cls, key):
                model = cls(**PARAMS[key])
                model.load_state_dict(torch.load(root / WEIGHTS[key], map_location="cpu", weights_only=False))
                return model.to(self.device).eval()

            models = {
                "appearance": load(AppearanceFeatureExtractor, "appearance_feature_extractor"),
                "motion": load(MotionExtractor, "motion_extractor"),
                "warping": load(WarpingNetwork, "warping_module"),
                "generator": load(SPADEDecoder, "spade_generator"),
            }
            stitching = StitchingRetargetingNetwork(**PARAMS["stitching"])
            checkpoint = torch.load(root / WEIGHTS["stitching_retargeting_module"], map_location="cpu", weights_only=False)
            stitching.load_state_dict(_strip_ddp(checkpoint["retarget_shoulder"]))
            models["stitching"] = stitching.to(self.device).eval()
            self.models = models
            self.status.state, self.status.device = "ready", self.device.type
            self.status.detail = f"LivePortrait on {self.device.type.upper()}" + ("" if self.device.type == "cuda" else " (about 1 fps: a CUDA GPU is needed for live use)")

    @property
    def ready(self) -> bool:
        return self.models is not None

    # ------------------------------------------------------------ inference
    @staticmethod
    def _tensor(rgb: np.ndarray, device: torch.device) -> torch.Tensor:
        if rgb.shape[:2] != (CROP, CROP):
            rgb = np.asarray(Image.fromarray(rgb).resize((CROP, CROP), Image.BILINEAR))
        x = torch.from_numpy(np.ascontiguousarray(rgb)).float().div(255.0).permute(2, 0, 1)[None]
        return x.to(device)

    @torch.no_grad()
    def _kp_info(self, x: torch.Tensor) -> dict:
        info = self.models["motion"](x)
        bs = info["kp"].shape[0]
        for k in ("pitch", "yaw", "roll"):
            info[k] = headpose_pred_to_degree(info[k])[:, None]
        info["kp"] = info["kp"].reshape(bs, -1, 3)
        info["exp"] = info["exp"].reshape(bs, -1, 3)
        return info

    @staticmethod
    def _transform(kp: torch.Tensor, rotation: torch.Tensor, exp: torch.Tensor, scale: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        # Eqn. 2 of the paper: s * (x_c R + exp) + t (tx, ty only)
        out = (kp @ rotation + exp) * scale[..., None]
        out[:, :, 0:2] += t[:, None, 0:2]
        return out

    @torch.no_grad()
    def prepare_source(self, rgb: np.ndarray) -> _Source:
        x = self._tensor(rgb, self.device)
        info = self._kp_info(x)
        rotation = get_rotation_matrix(info["pitch"], info["yaw"], info["roll"])
        kp = self._transform(info["kp"], rotation, info["exp"], info["scale"], info["t"])
        return _Source(feature_3d=self.models["appearance"](x).float(), kp_canonical=info["kp"], info=info, rotation=rotation, kp=kp)

    @torch.no_grad()
    def driving_info(self, rgb: np.ndarray) -> dict:
        info = self._kp_info(self._tensor(rgb, self.device))
        info["rotation"] = get_rotation_matrix(info["pitch"], info["yaw"], info["roll"])
        return info

    @torch.no_grad()
    def animate(self, source: _Source, neutral: dict, driving: dict, expression_gain: float = 1.0, head_gain: float = 1.0) -> np.ndarray:
        """Relative motion transfer (LivePortrait's 'relative' mode) plus stitching. Returns 512x512x3 uint8."""
        t0 = time.perf_counter()
        s = source.info
        # Rotation: the change of the user's head from neutral, applied to the portrait's own pose.
        delta_rot = driving["rotation"] @ neutral["rotation"].permute(0, 2, 1)
        if head_gain != 1.0:
            delta_rot = torch.lerp(torch.eye(3, device=delta_rot.device)[None], delta_rot, head_gain)
        rotation = delta_rot @ source.rotation
        exp = s["exp"] + (driving["exp"] - neutral["exp"]) * expression_gain
        scale = s["scale"] * (driving["scale"] / neutral["scale"])
        t = s["t"] + (driving["t"] - neutral["t"]) * head_gain
        t[..., 2] = 0
        kp_driving = self._transform(source.kp_canonical, rotation, exp, scale, t)
        # Stitching keeps the animated face aligned with the unchanged surroundings of the crop.
        delta = self.models["stitching"](torch.cat([source.kp.view(1, -1), kp_driving.view(1, -1)], dim=1))
        num_kp = kp_driving.shape[1]
        kp_driving = kp_driving + delta[..., : 3 * num_kp].reshape(1, num_kp, 3)
        kp_driving[..., :2] += delta[..., 3 * num_kp : 3 * num_kp + 2].reshape(1, 1, 2)
        warped = self.models["warping"](source.feature_3d, kp_driving=kp_driving, kp_source=source.kp)
        out = self.models["generator"](feature=warped["out"])
        image = (out[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy() * 255).astype(np.uint8)
        self.status.last_ms = (time.perf_counter() - t0) * 1000
        self.status.frames += 1
        return image


def decode_jpeg(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as image:
        return np.asarray(image.convert("RGB"))


def encode_jpeg(rgb: np.ndarray, quality: int = 90) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


face_generator = FaceGenerator()
