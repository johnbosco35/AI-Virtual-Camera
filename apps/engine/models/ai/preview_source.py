"""Neutral source utterance used to render voice previews.

Previews are produced by *converting* this utterance into each voice with the same speech-to-speech
model used live. On Windows the utterance is spoken once by the built-in offline SAPI voice; elsewhere,
or if SAPI is unavailable, the user's own calibration recording is used instead.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PREVIEW_TEXT = (
    "Hello! This is a preview of how this voice sounds. "
    "The words and rhythm come from the speaker, and the tone comes from the selected voice profile."
)


def synthesise_with_sapi(target: Path) -> bool:
    if sys.platform != "win32":
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    escaped_path = str(target).replace("'", "''")
    escaped_text = PREVIEW_TEXT.replace("'", "''")
    script = (
        "Add-Type -AssemblyName System.Speech;"
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "$s.Rate = 0;"
        f"$s.SetOutputToWaveFile('{escaped_path}');"
        f"$s.Speak('{escaped_text}');"
        "$s.Dispose()"
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True, timeout=60, check=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return False
    return target.is_file() and target.stat().st_size > 10_000
