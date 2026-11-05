// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 机翻打桩：按行"翻译"，能看出是不是一次翻了整段
const calls: string[] = [];
vi.mock('../src/lib/speech', () => ({
  translate: vi.fn(async (text: string) => { calls.push(text); return text.split('\n').map((l) => `ZH(${l})`).join('\n'); }),
  speak: vi.fn(),
}));

import { db } from '../src/db/db';
import { addClip, addNotes, clearAllLocalData, deleteClip, updateClip } from '../src/db/actions';
import { lookupWiktionnaire, parseWiktionnaire, sentenceAround, translateSenses } from '../src/lib/dictionary';
import { modeOf } from '../src/features/Lookup';
import { clipLine, matchNote } from '../src/features/add/ClipBasket';
import { applyRemoteFile, buildLocalFiles, clearFileCache } from '../src/sync/files';
import { exportBundle, importBundle } from '../src/io/bundle';

// 新版 MediaWiki：标题包在 div.mw-heading 里
const NEW = `<div class="mw-content-ltr mw-parser-output" lang="fr" dir="ltr">
<div class="mw-heading mw-heading2"><h2 id="Français"><span class="sectionlangue" id="fr"><a href="/wiki/fran%C3%A7ais">Français</a></span></h2></div>
<div class="mw-heading mw-heading3"><h3 id="Étymologie"><span class="titreetym">Étymologie</span></h3></div>
<dl><dd><span class="date">(1324)</span> Du latin <i>derogare</i> (« abroger partiellement »).</dd></dl>
<div class="mw-heading mw-heading3"><h3 id="Verbe"><span class="titredef" id="fr-verb">Verbe</span></h3></div>
<p><b>déroger</b> <span class="API">\\de.ʁɔ.ʒe\\</span> <i>intransitif</i> 1<sup>er</sup> groupe</p>
<ol><li><span class="term">(Droit)</span> Établir une disposition contraire à une loi.<sup class="reference">[1]</sup><ul><li><span class="example"><q><bdi lang="fr"><i>On ne peut déroger aux lois.</i></bdi></q> <span class="sources">— (Code civil, art. 6)</span></span></li></ul></li>
<li>S’écarter de ce qui est établi par une règle.<ol><li>Manquer à la dignité de son rang.</li></ol></li></ol>
<div class="mw-heading mw-heading4"><h4 id="Synonymes">Synonymes</h4></div>
<ul><li>enfreindre</li></ul>
<div class="mw-heading mw-heading3"><h3 id="Prononciation">Prononciation</h3></div>
<ul><li>\\de.ʁɔ.ʒe\\</li></ul>
<div class="mw-heading mw-heading2"><h2 id="Ancien_français">Ancien français</h2></div>
<div class="mw-heading mw-heading3"><h3 id="Verbe_2">Verbe</h3></div>
<ol><li>Ne doit pas apparaître.</li></ol>
</div>`;

// 旧版：标题文字在 span.mw-headline 里，带编辑链接；名词带阴阳性；同一个词性编号
const OLD = `<div class="mw-parser-output">
<h2><span class="mw-headline" id="Anglais">Anglais</span></h2><h3><span class="mw-headline">Nom commun</span></h3><ol><li>English sense.</li></ol>
<h2><span class="mw-headline" id="Français">Français</span><span class="mw-editsection">[modifier le wikicode]</span></h2>
<h3><span class="mw-headline" id="Nom_commun_1">Nom commun 1</span><span class="mw-editsection">[modifier]</span></h3>
<p><b>pavé</b> <span class="API">\\pa.ve\\</span> <span class="ligne-de-forme"><i>masculin</i></span></p>
<ol><li>Bloc de pierre taillé servant au revêtement des rues.</li><li><span class="term">(Familier)</span> Livre très épais.</li></ol>
<h3><span class="mw-headline" id="Adjectif">Adjectif</span></h3>
<p><b>pavé</b> <span class="ligne-de-forme"><i>masculin</i></span></p>
<ol><li>Couvert de pavés.</li></ol>
</div>`;

// 变形词条：只有 "Forme de verbe"，链接指向原形
const FORM = `<div class="mw-parser-output"><div class="mw-heading mw-heading2"><h2 id="Français">Français</h2></div>
<div class="mw-heading mw-heading3"><h3 id="Forme_de_verbe">Forme de verbe</h3></div>
<p><b>dérogeait</b> <i>intransitif</i></p>
<ol><li><i>Troisième personne du singulier de l’imparfait de</i> <a href="/wiki/d%C3%A9roger" title="déroger">déroger</a>.</li></ol></div>`;

describe('Wiktionnaire 解析', () => {
  it('变形词条：记下它指向的原形', () => {
    const r = parseWiktionnaire(FORM, 'dérogeait')!;
    expect(r.entries[0].pos).toBe('Forme de verbe');
    expect(r.formOf).toBe('déroger');
    expect(parseWiktionnaire(NEW, 'déroger')!.formOf).toBeNull();
  });
  it('新版标题：只取法语节，词性、释义、例句、子义项、词源', () => {
    const r = parseWiktionnaire(NEW, 'déroger')!;
    expect(r.title).toBe('déroger');
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e.pos).toBe('Verbe');
    expect(e.gender).toBeNull();
    expect(e.senses.map((x) => x.def)).toEqual([
      '(Droit) Établir une disposition contraire à une loi.',
      'S’écarter de ce qui est établi par une règle.',
      '· Manquer à la dignité de son rang.',
    ]);
    expect(e.senses[0].example).toBe('On ne peut déroger aux lois.');
    expect(r.etymology).toBe('(1324) Du latin derogare (« abroger partiellement »).');
  });
  it('旧版标题：去掉编辑链接和编号，名词带阴阳性，两个词性', () => {
    const r = parseWiktionnaire(OLD, 'pavé')!;
    expect(r.entries.map((e) => [e.pos, e.gender, e.senses.length])).toEqual([['Nom commun', 'masculin', 2], ['Adjectif', 'masculin', 1]]);
    expect(r.entries[0].senses[1].def).toBe('(Familier) Livre très épais.');
  });
  it('没有法语节 → null', () => {
    expect(parseWiktionnaire('<div class="mw-parser-output"><h2>Anglais</h2><ol><li>x</li></ol></div>', 'x')).toBeNull();
  });
});

describe('查词与机翻', () => {
  beforeEach(async () => { calls.length = 0; await db.cache.clear(); });
  it('几条释义拼成一段一次翻，再按行拆回', async () => {
    const r = await translateSenses(['Établir une loi.', 'S’écarter de la règle.'], 'fr', 'zh-CN');
    expect(calls).toEqual(['Établir une loi.\nS’écarter de la règle.']);
    expect(r.lines).toEqual(['ZH(Établir une loi.)', 'ZH(S’écarter de la règle.)']);
  });
  it('结果缓存：同一段不再请求', async () => {
    await translateSenses(['a', 'b'], 'fr', 'zh-CN');
    await translateSenses(['a', 'b'], 'fr', 'zh-CN');
    expect(calls).toHaveLength(1);
  });
  it('依次试原形、原样；页面不存在缓存为 null，网络错误抛出', async () => {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const page = decodeURIComponent(new URL(url).searchParams.get('page')!);
      fetched.push(page);
      expect(new URL(url).searchParams.get('origin')).toBe('*');
      if (page === 'déroger') return new Response(JSON.stringify({ parse: { title: 'déroger', text: NEW } }));
      if (page === 'dérogea') return new Response(JSON.stringify({ parse: { title: 'dérogea', text: FORM } }));
      return new Response(JSON.stringify({ error: { code: 'missingtitle' } }));
    }));
    const r = await lookupWiktionnaire(['Dérogeait', 'déroger']);
    expect(r?.title).toBe('déroger');
    expect(fetched).toEqual(['Dérogeait', 'dérogeait', 'déroger']);
    fetched.length = 0;
    await lookupWiktionnaire(['Dérogeait', 'déroger']);
    expect(fetched).toEqual([]); // 全部走缓存
    // 查到的只是变形：顺着链接查原形，带上变形的说明
    fetched.length = 0;
    const f = await lookupWiktionnaire(['dérogea']);
    expect(fetched).toEqual(['dérogea']); // 原形 déroger 前面查过，走缓存
    expect(f?.title).toBe('déroger');
    expect(f?.formNote).toBe('Troisième personne du singulier de l’imparfait de déroger.');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(lookupWiktionnaire(['autre'])).rejects.toThrow();
    vi.unstubAllGlobals();
  });
  it('所在句子、选区类型', () => {
    const block = 'Il pleut. On ne peut pas déroger à cette règle, même en cas d’urgence ! Fin';
    const i = block.indexOf('déroger');
    expect(sentenceAround(block, i, i + 7)).toBe('On ne peut pas déroger à cette règle, même en cas d’urgence !');
    expect(modeOf('déroger')).toBe('word');
    expect(modeOf("l'impartialité")).toBe('word');
    expect(modeOf('à condition de')).toBe('phrase');
    expect(modeOf('On ne peut pas déroger à cette règle.')).toBe('sentence');
  });
});

describe('摘句篮', () => {
  beforeEach(async () => { await clearAllLocalData(); clearFileCache(); });
  it('同一句里的同一个词不重复放', async () => {
    const a = await addClip({ kind: 'expr', text: 'déroger', context: 'On ne peut pas {{déroger}} à la règle.' });
    const b = await addClip({ kind: 'expr', text: 'Déroger', context: 'On ne peut pas {{déroger}} à la règle.' });
    expect(b).toEqual({ id: a.id, existed: true });
    expect(await db.clips.count()).toBe(1);
  });
  it('同步文件：clips/月份.json，远端合并；删除是墓碑', async () => {
    const { id } = await addClip({ kind: 'expr', text: 'pillage', context: 'le {{pillage}} des magasins', source: 'émeute' });
    const files = await buildLocalFiles();
    const rel = [...files.keys()].find((k) => k.startsWith('clips/'))!;
    expect(rel).toMatch(/^clips\/\d{4}-\d{2}\.json$/);
    const text = files.get(rel)!;
    expect(JSON.parse(text).clips[0]).toMatchObject({ text: 'pillage', status: 'todo', source: 'émeute' });
    await clearAllLocalData();
    await applyRemoteFile(rel, text);
    expect((await db.clips.get(id))?.text).toBe('pillage');
    await deleteClip(id);
    expect((await db.clips.get(id))?.deleted).toBe(true);
  });
  it('备份导出 / 导入带上摘句篮；旧备份没有 clips 也能导入', async () => {
    await addClip({ kind: 'sentence', text: 'Il faut faire preuve de patience.', context: 'Il faut faire preuve de patience.' });
    const b = await exportBundle();
    expect(b.clips).toHaveLength(1);
    await clearAllLocalData();
    expect((await importBundle(b)).clips.added).toBe(1);
    const old = { ...b, clips: undefined };
    await clearAllLocalData();
    expect((await importBundle(old)).clips.added).toBe(0);
  });
  it('复制格式和导入后的自动匹配', async () => {
    const { id } = await addClip({ kind: 'expr', text: 'déroger', context: 'On ne peut pas {{déroger}} à la règle.' });
    const clip = (await db.clips.get(id))!;
    expect(clipLine(clip)).toBe('déroger(On ne peut pas déroger à la règle.');
    expect(clipLine({ ...clip, kind: 'sentence', context: 'Une phrase entière.' })).toBe('整句：Une phrase entière.');
    await new Promise((r) => setTimeout(r, 5));
    await addNotes([{ deckId: 'd', lemma: 'déroger à qqch', sentence: 'Seul le jury peut {{déroger à}} la règle.' }]);
    const notes = await db.notes.toArray();
    expect(matchNote(clip, notes)?.lemma).toBe('déroger à qqch');
    // 不相关的词不匹配
    expect(matchNote({ ...clip, text: 'pillage' }, notes)).toBeUndefined();
    // 手动放回待做后（updatedAt 晚于笔记），旧笔记不再算数
    await new Promise((r) => setTimeout(r, 5));
    await updateClip(id, { status: 'todo', noteId: null });
    expect(matchNote((await db.clips.get(id))!, notes)).toBeUndefined();
  });
});
