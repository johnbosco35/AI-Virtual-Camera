"""Streaming converter mechanics, with a stand-in model so no weights are needed."""
import unittest

import numpy as np
import torch

from models.ai.hardware import choose_block_ms
from models.ai.streaming import StreamingVoiceConverter
from models.ai.viseme import VisemeAnalyzer


class IdentityModel:
    """Behaves like the converter but returns its input unchanged (and counts calls)."""

    sample_rate = 22050
    hop_length = 256

    def __init__(self):
        self.convert_calls = 0
        self.embedding_calls = 0

    def convert(self, audio, source_se, target_se, tau=None):
        self.convert_calls += 1
        return audio.copy()

    def extract_embedding(self, audio, segment_seconds=8.0):
        self.embedding_calls += 1
        return torch.ones(1, 256, 1)


def make_streamer(model, block_ms=400, input_sr=48000):
    se = torch.zeros(1, 256, 1)
    return StreamingVoiceConverter(model, input_sr, se, None, se, block_ms=block_ms, context_ms=320, crossfade_ms=40, silence_dbfs=-48)


def pcm16(signal):
    return (np.clip(signal, -1, 1) * 32767).astype("<i2").tobytes()


class StreamingTests(unittest.TestCase):
    def feed(self, streamer, signal, frame=960):
        data = pcm16(signal)
        blocks = []
        for i in range(0, len(data), frame * 2):
            streamer.feed_pcm16(data[i : i + frame * 2])
            while (block := streamer.process_next()) is not None:
                blocks.append(block)
        return blocks

    def test_blocks_are_hop_aligned_and_timeline_is_continuous(self):
        model = IdentityModel()
        streamer = make_streamer(model)
        self.assertEqual(streamer.block % model.hop_length, 0)
        t = np.arange(48000 * 3) / 48000
        blocks = self.feed(streamer, 0.3 * np.sin(2 * np.pi * 220 * t))
        self.assertGreaterEqual(len(blocks), 6)
        ends = [b.input_end for b in blocks]
        steps = np.diff(ends)
        expected = streamer.block * 48000 / 22050
        self.assertTrue(np.all(np.abs(steps - expected) <= 1), steps)
        for b in blocks:
            self.assertEqual(len(b.audio), streamer.block)
            self.assertEqual(len(b.visemes), streamer.block // model.hop_length)

    def test_identity_model_reconstructs_the_signal_without_clicks(self):
        model = IdentityModel()
        streamer = make_streamer(model)
        t = np.arange(48000 * 3) / 48000
        blocks = self.feed(streamer, 0.3 * np.sin(2 * np.pi * 220 * t))
        out = np.concatenate([b.audio for b in blocks])[streamer.block :]  # skip warm-up block
        # A clean 220 Hz sine has small sample-to-sample steps; a seam would show up as a spike.
        max_step = np.max(np.abs(np.diff(out)))
        self.assertLess(max_step, 0.3 * 2 * np.pi * 220 / 22050 * 1.6)
        self.assertGreater(np.abs(out).max(), 0.25)

    def test_silence_skips_inference(self):
        model = IdentityModel()
        streamer = make_streamer(model)
        blocks = self.feed(streamer, np.zeros(48000 * 2))
        self.assertGreater(len(blocks), 3)
        self.assertEqual(model.convert_calls, 0)
        self.assertTrue(all(not b.voiced for b in blocks))
        self.assertTrue(all(np.all(b.audio == 0) for b in blocks))

    def test_source_voice_is_estimated_from_live_speech(self):
        model = IdentityModel()
        streamer = make_streamer(model)
        self.assertFalse(streamer.source_ready)
        t = np.arange(48000 * 4) / 48000
        self.feed(streamer, 0.3 * np.sin(2 * np.pi * 180 * t))
        self.assertTrue(streamer.source_ready)
        self.assertGreaterEqual(model.embedding_calls, 1)

    def test_backlog_is_bounded(self):
        model = IdentityModel()
        streamer = make_streamer(model)
        streamer.feed_pcm16(pcm16(0.2 * np.ones(48000 * 5)))
        self.assertGreater(streamer.blocks_ready(), 4)
        dropped = streamer.drop_backlog(keep_blocks=2)
        self.assertGreater(dropped, 0)
        self.assertEqual(streamer.blocks_ready(), 2)
        self.assertEqual(streamer.dropped_blocks, dropped)


class VisemeTests(unittest.TestCase):
    sr = 22050

    def tone(self, freqs, seconds=0.5, amp=0.3):
        t = np.arange(int(self.sr * seconds)) / self.sr
        return (amp * sum(np.sin(2 * np.pi * f * t) for f in freqs) / len(freqs)).astype(np.float32)

    def test_silence_keeps_the_mouth_closed(self):
        v = VisemeAnalyzer(self.sr).analyse(np.zeros(self.sr // 2, dtype=np.float32))
        self.assertLess(v.max(), 1e-3)

    def test_open_vowel_opens_the_jaw_more_than_a_fricative(self):
        vowel = VisemeAnalyzer(self.sr).analyse(self.tone([150, 700, 1100]))
        rng = np.random.default_rng(0)
        hiss = rng.normal(0, 0.1, self.sr // 2).astype(np.float32)
        hiss = np.convolve(hiss, [1, -1], mode="same").astype(np.float32)  # emphasise high frequencies
        fricative = VisemeAnalyzer(self.sr).analyse(hiss)
        self.assertGreater(vowel[-10:, 0].mean(), 0.4)
        self.assertGreater(vowel[-10:, 0].mean(), fricative[-10:, 0].mean())
        self.assertGreater(fricative[-10:, 2].mean(), fricative[-10:, 1].mean())  # spread, not rounded

    def test_back_vowel_rounds_the_lips(self):
        oo = VisemeAnalyzer(self.sr).analyse(self.tone([150, 300, 700]))
        ee = VisemeAnalyzer(self.sr).analyse(self.tone([150, 300, 2400]))
        self.assertGreater(oo[-10:, 1].mean(), ee[-10:, 1].mean())
        self.assertGreater(ee[-10:, 2].mean(), oo[-10:, 2].mean())


class BlockSizeTests(unittest.TestCase):
    def test_fast_machine_gets_small_blocks(self):
        self.assertEqual(choose_block_ms(0.05, 320), 200)

    def test_slow_machine_gets_larger_blocks(self):
        block = choose_block_ms(0.5, 320)
        self.assertIsNotNone(block)
        self.assertGreater(block, 600)

    def test_too_slow_machine_is_flagged(self):
        self.assertIsNone(choose_block_ms(2.5, 320))


if __name__ == "__main__":
    unittest.main()
