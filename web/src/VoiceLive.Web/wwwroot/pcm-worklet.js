class Pcm16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 24000;
    this.sourceRate = sampleRate;
    this.pending = [];
    this.pendingLength = 0;
    this.positionNumerator = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    if (this.sourceRate === this.targetRate) {
      const pcm = this.floatToPcm(input);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      return true;
    }

    this.enqueue(input);
    const availableNumerator =
      this.pendingLength * this.targetRate - this.positionNumerator;
    const outputSamples = Math.ceil(availableNumerator / this.sourceRate);
    if (outputSamples <= 0) return true;

    const pcm = new Int16Array(outputSamples);
    for (let i = 0; i < outputSamples; i++) {
      const sourceIndex = Math.floor(this.positionNumerator / this.targetRate);
      pcm[i] = this.sampleToInt16(this.getSample(sourceIndex));
      this.positionNumerator += this.sourceRate;
    }
    this.compact();
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }

  enqueue(input) {
    const copy = new Float32Array(input.length);
    copy.set(input);
    this.pending.push(copy);
    this.pendingLength += copy.length;
  }

  getSample(index) {
    let offset = index;
    for (const chunk of this.pending) {
      if (offset < chunk.length) return chunk[offset];
      offset -= chunk.length;
    }
    return 0;
  }

  compact() {
    while (
      this.pending.length > 0 &&
      this.positionNumerator >= this.pending[0].length * this.targetRate
    ) {
      this.positionNumerator -= this.pending[0].length * this.targetRate;
      this.pendingLength -= this.pending[0].length;
      this.pending.shift();
    }
  }

  floatToPcm(input) {
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) pcm[i] = this.sampleToInt16(input[i]);
    return pcm;
  }

  sampleToInt16(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
}

registerProcessor("pcm16-worklet", Pcm16Worklet);
