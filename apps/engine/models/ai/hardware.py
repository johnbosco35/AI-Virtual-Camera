"""Hardware probing and requirement checks so the UI can say clearly when this PC is too slow."""
from __future__ import annotations

import ctypes
import os
import platform
import subprocess
import sys

import torch

# Inference must use at most this share of each block's duration to keep up in real time.
REALTIME_BUDGET = 0.75
MIN_BLOCK_MS, MAX_BLOCK_MS = 200, 1200


def total_ram_gb() -> float:
    if sys.platform == "win32":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        status = MemoryStatus()
        status.dwLength = ctypes.sizeof(MemoryStatus)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        return status.ullTotalPhys / 1024**3
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
    except (ValueError, OSError, AttributeError):
        return 0.0


def cpu_name() -> str:
    if sys.platform == "win32":
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                capture_output=True, text=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ).stdout.strip()
            if out:
                return out
        except Exception:
            pass
    return platform.processor() or platform.machine()


def probe() -> dict:
    cuda = torch.cuda.is_available()
    return {
        "os": f"{platform.system()} {platform.release()}",
        "cpu": cpu_name(),
        "logical_cores": os.cpu_count() or 1,
        "ram_gb": round(total_ram_gb(), 1),
        "cuda": cuda,
        "gpu": torch.cuda.get_device_name(0) if cuda else None,
        "torch": torch.__version__,
        "python": platform.python_version(),
    }


def choose_block_ms(rtf: float, context_ms: int) -> int | None:
    """Smallest block that keeps (block + context) * rtf within the real-time budget, or None if impossible."""
    if rtf >= REALTIME_BUDGET:
        return None
    block = context_ms * rtf / (REALTIME_BUDGET - rtf)
    block = max(MIN_BLOCK_MS, block * 1.15)  # headroom for jitter and the tracking/render load
    return int(block) if block <= MAX_BLOCK_MS else None


def requirements(hardware: dict, benchmark: dict | None, model_ready: bool, context_ms: int) -> list[dict]:
    checks: list[dict] = []
    cores = hardware.get("logical_cores", 1)
    checks.append({
        "id": "cpu", "label": "Processor",
        "status": "ok" if cores >= 8 else "warn" if cores >= 4 else "fail",
        "detail": f"{hardware.get('cpu')} · {cores} logical cores (8+ recommended for voice conversion alongside tracking).",
    })
    ram = hardware.get("ram_gb", 0)
    checks.append({
        "id": "ram", "label": "Memory",
        "status": "ok" if ram >= 8 else "warn" if ram >= 3.5 else "fail",
        "detail": f"{ram} GB installed (8 GB recommended).",
    })
    checks.append({
        "id": "gpu", "label": "CUDA GPU (optional)",
        "status": "ok" if hardware.get("cuda") else "warn",
        "detail": hardware.get("gpu") or "Not available. Voice conversion runs on the CPU; face tracking and rendering still use the integrated GPU via WebGL.",
    })
    if not model_ready:
        checks.append({"id": "voice", "label": "Real-time voice conversion", "status": "warn", "detail": "Download and load the voice model to measure performance."})
    elif benchmark:
        rtf = benchmark["rtf"]
        block = choose_block_ms(rtf, context_ms)
        if block is None:
            checks.append({
                "id": "voice", "label": "Real-time voice conversion", "status": "fail",
                "detail": f"Real-time factor {rtf:.2f}: this PC converts speech {rtf:.1f}x slower than it is spoken. Conversion runs in buffered mode (continuous, but the voice lags while you talk and catches up in pauses). A 6+ core CPU or CUDA GPU is needed for live conversion.",
            })
        else:
            checks.append({
                "id": "voice", "label": "Real-time voice conversion",
                "status": "ok" if block <= 400 else "warn",
                "detail": f"Real-time factor {rtf:.2f}. Streaming block {block} ms → about {block + 80} ms added voice latency.",
            })
    return checks
