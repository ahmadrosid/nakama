// The AudioContext supplies mono audio at 24 kHz; only PCM16 encoding is needed.
class NakamaPcmProcessor extends globalThis.AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input?.length) {
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = sample < 0 ? sample * 32_768 : sample * 32_767;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

globalThis.registerProcessor("nakama-pcm", NakamaPcmProcessor);
