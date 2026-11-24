/* global sampleRate, currentFrame, registerProcessor, AudioWorkletProcessor */
/**
 * Captures mono microphone audio off the main thread in ~20 ms frames.
 * mode "pcm16": posts Int16Array frames (for streaming to the engine)
 * mode "float": posts Float32Array frames (for local recording)
 * Each message carries the audio-clock frame index of its first sample, so the page can map
 * engine output back to capture time and measure true end-to-end latency.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.mode = (options.processorOptions && options.processorOptions.mode) || 'pcm16';
    this.frameSize = Math.round(sampleRate * 0.02);
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
    this.startFrame = 0;
    this.enabled = true;
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.enabled === 'boolean') this.enabled = event.data.enabled;
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i += 1) {
      if (this.filled === 0) this.startFrame = currentFrame + i;
      this.buffer[this.filled] = this.enabled ? channel[i] : 0;
      this.filled += 1;
      if (this.filled === this.frameSize) this.flush();
    }
    return true;
  }

  flush() {
    let sum = 0;
    for (let i = 0; i < this.frameSize; i += 1) sum += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sum / this.frameSize);
    if (this.mode === 'float') {
      const copy = this.buffer.slice();
      this.port.postMessage({ samples: copy, startFrame: this.startFrame, rms }, [copy.buffer]);
    } else {
      const pcm = new Int16Array(this.frameSize);
      for (let i = 0; i < this.frameSize; i += 1) {
        const s = Math.max(-1, Math.min(1, this.buffer[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ pcm, startFrame: this.startFrame, rms }, [pcm.buffer]);
    }
    this.filled = 0;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
