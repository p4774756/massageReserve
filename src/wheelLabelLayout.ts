/**
 * 輪盤扇區文字：徑向位置與依弦寬估算的換行（SVG 無 canvas 量測時用字數上限）。
 */

/** 標籤錨點半徑：略偏外環，避開靠 hub 的狹窄帶 */
export function wheelSliceLabelRadius(rOut: number, rIn: number): number {
  return rIn + (rOut - rIn) * 0.7;
}

/** 在單位圓 viewBox 下，labelR 處扇形弧對應的弦寬（可放字的徑向寬度） */
export function chordWidthAtRadius(labelR: number, sweepDeg: number): number {
  const half = (Math.abs(sweepDeg) * Math.PI) / 360;
  return 2 * labelR * Math.sin(half);
}

function chunkByMaxLen(word: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i += max) {
    out.push(word.slice(i, i + max));
  }
  return out;
}

/**
 * 依每行字數上限換行：有空白先斷詞；長詞（含純中文）再硬切。
 */
export function wrapWheelLabelLinesByCharCount(name: string, maxCharsPerLine: number): string[] {
  const s = name.trim();
  if (!s) return [];
  const max = Math.max(2, maxCharsPerLine);
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";

  const pushCur = () => {
    if (cur) {
      lines.push(cur);
      cur = "";
    }
  };

  for (const word of words) {
    const chunks = word.length > max ? chunkByMaxLen(word, max) : [word];
    for (const chunk of chunks) {
      const joint = cur ? `${cur} ${chunk}` : chunk;
      if (joint.length <= max) {
        cur = joint;
      } else {
        pushCur();
        cur = chunk;
      }
    }
  }
  pushCur();
  return lines;
}
