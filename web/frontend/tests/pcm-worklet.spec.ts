import { expect, Page, test } from "@playwright/test";

async function countPostedSamples(page: Page, sourceRate: number, inputSamples: number) {
  await page.goto("/");

  return page.evaluate(
    async ({ sourceRate, inputSamples }) => {
      let processorConstructor:
        | (new () => { process(inputs: Float32Array[][]): boolean })
        | undefined;
      let postedSamples = 0;

      class MockAudioWorkletProcessor {
        port = {
          postMessage(message: ArrayBuffer, transfer: Transferable[]) {
            postedSamples += new Int16Array(message).length;
            structuredClone(message, { transfer });
          },
        };
      }

      Object.assign(globalThis, {
        AudioWorkletProcessor: MockAudioWorkletProcessor,
        registerProcessor: (
          _name: string,
          constructor: new () => { process(inputs: Float32Array[][]): boolean },
        ) => {
          processorConstructor = constructor;
        },
        sampleRate: sourceRate,
      });

      const script = await (await fetch("/pcm-worklet.js")).text();
      (0, eval)(script);
      if (!processorConstructor) throw new Error("pcm16-worklet was not registered");

      const processor = new processorConstructor();
      for (let offset = 0; offset < inputSamples; offset += 128) {
        const chunkLength = Math.min(128, inputSamples - offset);
        processor.process([[new Float32Array(chunkLength)]]);
      }

      return postedSamples;
    },
    { sourceRate, inputSamples },
  );
}

async function comparePostedSamples(page: Page, sourceRate: number, durationSeconds: number) {
  await page.goto("/");

  return page.evaluate(
    async ({ sourceRate, durationSeconds }) => {
      let processorConstructor:
        | (new () => { process(inputs: Float32Array[][]): boolean })
        | undefined;
      const postedChunks: Int16Array[] = [];

      class MockAudioWorkletProcessor {
        port = {
          postMessage(message: ArrayBuffer, transfer: Transferable[]) {
            postedChunks.push(new Int16Array(new Int16Array(message)));
            structuredClone(message, { transfer });
          },
        };
      }

      Object.assign(globalThis, {
        AudioWorkletProcessor: MockAudioWorkletProcessor,
        registerProcessor: (
          _name: string,
          constructor: new () => { process(inputs: Float32Array[][]): boolean },
        ) => {
          processorConstructor = constructor;
        },
        sampleRate: sourceRate,
      });

      const script = await (await fetch("/pcm-worklet.js")).text();
      (0, eval)(script);
      if (!processorConstructor) throw new Error("pcm16-worklet was not registered");

      const sampleAt = (index: number) => Math.fround(((index % 20_001) - 10_000) / 12_000);
      const toPcm16 = (sample: number) =>
        Math.trunc(sample < 0 ? Math.max(-1, sample) * 0x8000 : Math.min(1, sample) * 0x7fff);
      const inputSamples = sourceRate * durationSeconds;
      const processor = new processorConstructor();

      for (let offset = 0; offset < inputSamples; offset += 128) {
        const chunkLength = Math.min(128, inputSamples - offset);
        const chunk = Float32Array.from({ length: chunkLength }, (_, index) =>
          sampleAt(offset + index),
        );
        processor.process([[chunk]]);
      }

      const actual = new Int16Array(postedChunks.reduce((total, chunk) => total + chunk.length, 0));
      let writeOffset = 0;
      for (const chunk of postedChunks) {
        actual.set(chunk, writeOffset);
        writeOffset += chunk.length;
      }

      let mismatches = 0;
      let firstMismatch:
        | { outputIndex: number; sourceIndex: number; expected: number; actual: number }
        | undefined;
      for (let outputIndex = 0; outputIndex < actual.length; outputIndex++) {
        const sourceIndex = Math.floor((outputIndex * sourceRate) / 24_000);
        const expected = toPcm16(sampleAt(sourceIndex));
        if (actual[outputIndex] !== expected) {
          mismatches++;
          firstMismatch ??= { outputIndex, sourceIndex, expected, actual: actual[outputIndex] };
        }
      }

      return { outputSamples: actual.length, mismatches, firstMismatch };
    },
    { sourceRate, durationSeconds },
  );
}

test("resamples one second from 44.1 kHz to exactly 24,000 samples", async ({ page }) => {
  expect(await countPostedSamples(page, 44_100, 44_100)).toBe(24_000);
});

test("resamples one second from 48 kHz to exactly 24,000 samples", async ({ page }) => {
  expect(await countPostedSamples(page, 48_000, 48_000)).toBe(24_000);
});

test("passes through one second at 24 kHz as exactly 24,000 samples", async ({ page }) => {
  expect(await countPostedSamples(page, 24_000, 24_000)).toBe(24_000);
});

test("selects every exact source sample over ten seconds at 44.1 kHz", async ({ page }) => {
  const result = await comparePostedSamples(page, 44_100, 10);

  expect(result.outputSamples).toBe(240_000);
  expect(result.mismatches, JSON.stringify(result.firstMismatch)).toBe(0);
});
