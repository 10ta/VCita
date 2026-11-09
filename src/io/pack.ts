// 备份文件瘦身：不写和默认值相同的字段、不缩进、gzip 压缩。导入时都能还原。
// 只用在 设置 → 导出备份；GitHub 同步的文件格式不受影响。
import type { z } from 'zod';
import type { BundleFile } from '../schema';
import { CardV2, ClipV2, DeckV2, EncounterV2, KnownV2, NoteV2, ReviewLogV2, TextV2 } from '../schema/v2';

const TABLES = { decks: DeckV2, notes: NoteV2, cards: CardV2, logs: ReviewLogV2, clips: ClipV2, texts: TextV2, encounters: EncounterV2, known: KnownV2 } as const;
type Table = keyof typeof TABLES;
type Row = Record<string, unknown>;

const isEmptyObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length;
/** 可能是默认值的值：只考虑这几种，免得为每个不同的数字都去试一次 */
const trivial = (v: unknown) => v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || isEmptyObject(v);
/** 键排序后的 JSON，用来比较两条记录是否完全一样 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function compactRows(rows: Row[], schema: z.ZodType): Row[] {
  // (字段, 值) → 删掉这个字段后，按 schema 解析能不能原样补回来
  const cache = new Map<string, boolean>();
  return rows.map((row) => {
    const out: Row = { ...row };
    for (const [k, v] of Object.entries(row)) {
      if (!trivial(v)) continue;
      const key = `${k}\u0000${stable(v)}`;
      let ok = cache.get(key);
      if (ok === undefined) {
        const probe: Row = { ...row };
        delete probe[k];
        const r = schema.safeParse(probe);
        ok = r.success && Object.prototype.hasOwnProperty.call(r.data, k) && stable((r.data as Row)[k]) === stable(v);
        cache.set(key, ok);
      }
      if (ok) delete out[k];
    }
    // 再核对一遍：精简后的记录解析出来必须和原记录解析出来完全一样，不一样就保留原样
    const a = schema.safeParse(out);
    const b = schema.safeParse(row);
    return a.success && b.success && stable(a.data) === stable(b.data) ? out : row;
  });
}

/** 去掉每条记录里和默认值相同的字段（null、false、0、空串、空列表）；导入时 schema 会补回默认值 */
export function compactBundle(b: BundleFile): Row {
  const out: Row = { ...b };
  for (const t of Object.keys(TABLES) as Table[]) out[t] = compactRows(b[t] as unknown as Row[], TABLES[t]);
  return out;
}

/** 导出用的文本：精简字段、不缩进 */
export const bundleText = (b: BundleFile) => JSON.stringify(compactBundle(b));

export const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** 读备份文件：gzip（开头是 1f 8b）先解压，否则按 UTF-8 文本读 */
export async function readBackupText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (!canGzip()) throw new Error('这个浏览器不支持解压 .gz，请先解压再导入');
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return file.text();
}
