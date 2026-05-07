/**
 * 產生小瑪莉可選同源音效（極短 WAV），供瀏覽器以 fetch 載入驗證流程。
 * 可替換為自行錄製或 CDN 上的檔案；亦可用 VITE_LM_SFX_* 指向任意 HTTPS URL。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "media", "lm");

function encodeWavPcm16Mono(samples, sampleRate) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/** 偏亮的「叮」：基音 + 三倍頻，略短 */
function brightBlip({ freq, seconds, sampleRate, volume, fadeOut = true }) {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const ph = 2 * Math.PI * freq * t;
    const env = fadeOut ? 1 - i / Math.max(1, n - 1) : 1;
    const s = 0.62 * Math.sin(ph) + 0.28 * Math.sin(ph * 3) + 0.1 * Math.sin(ph * 5);
    out[i] = s * volume * env;
  }
  return out;
}

function writeFile(name, samples, sampleRate) {
  fs.mkdirSync(outDir, { recursive: true });
  const fp = path.join(outDir, name);
  fs.writeFileSync(fp, encodeWavPcm16Mono(samples, sampleRate));
  console.log("wrote", fp);
}

const sr = 22050;

writeFile(
  "spin-tick.wav",
  brightBlip({ freq: 1760, seconds: 0.032, sampleRate: sr, volume: 0.3, fadeOut: true }),
  sr,
);

const spinStart = new Float32Array(Math.floor(sr * 0.18));
for (let i = 0; i < spinStart.length; i++) {
  const t = i / sr;
  const dur = 0.18;
  const f = 480 * Math.pow(2400 / 480, t / dur);
  const ph = 2 * Math.PI * f * t;
  const s = 0.55 * Math.sin(ph) + 0.35 * Math.sin(ph * 2);
  spinStart[i] = s * 0.24 * (1 - i / spinStart.length);
}
writeFile("spin-start.wav", spinStart, sr);
