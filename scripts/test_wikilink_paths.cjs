const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../web/node_modules/typescript");
const fixture = require("./fixtures/wikilink_paths.json");
const source = fs.readFileSync(path.join(__dirname, "../web/src/components/memo/wikilinkPaths.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(js, context);
const { buildLinkCandidates, resolveLink, newLinkTarget, linkCreationLocation, wikilinkDisplayLabel } = context.exports;
const candidates = buildLinkCandidates(fixture.notes, fixture.folders);
for (const check of fixture.cases) {
  assert.deepEqual(Array.from(resolveLink(check.target, candidates, check.source), (n) => n.id), check.ids, check.target);
}
assert.equal(newLinkTarget("새 노트", "project", fixture.folders), "/업무/프로젝트/새 노트");
const created = linkCreationLocation("/업무/프로젝트/새 노트", fixture.folders);
assert.equal(created.folderId, "project");
assert.equal(created.title, "새 노트");
assert.equal(linkCreationLocation("/없는폴더/새 노트", fixture.folders), null);
assert.equal(linkCreationLocation("/업무/새 노트", fixture.folders), null);
const special = candidates.find((n) => n.id === "special");
assert.equal(linkCreationLocation(special.path, fixture.folders).title, "회의/메모%");
assert.equal(wikilinkDisplayLabel("/링크 테스트"), "링크 테스트");
assert.equal(wikilinkDisplayLabel("/업무/프로젝트/회의록"), "회의록");
assert.equal(wikilinkDisplayLabel("/업무/회의%2F메모%25"), "회의/메모%");
assert.equal(wikilinkDisplayLabel("제목%20그대로"), "제목%20그대로");
assert.equal(wikilinkDisplayLabel("/잘못된%경로"), "잘못된%경로");
const markdownSource = fs.readFileSync(path.join(__dirname, "../web/src/components/memo/markdown.ts"), "utf8");
const markdownJs = ts.transpileModule(markdownSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const markdownContext = { exports: {}, require: () => context.exports };
vm.runInNewContext(markdownJs, markdownContext);
const { renderInlineMarkdown, parseWikilinks, isWikilinkEditPosition } = markdownContext.exports;
const rendered = renderInlineMarkdown("[[/업무/회의록]]");
assert.ok(rendered.includes('data-link="/업무/회의록"'));
assert.ok(rendered.includes('title="/업무/회의록"'));
assert.ok(rendered.endsWith('>회의록</a>'));
assert.ok(renderInlineMarkdown("[[/폴더/%3Cimg%3E]]").endsWith('>&lt;img&gt;</a>'));
assert.ok(renderInlineMarkdown("[[/폴더/A&B]]").endsWith('>A&amp;B</a>'));
// 링크 제목 안의 굵게·코드 문자는 서식으로 바뀌지 않고, 링크 밖 서식은 그대로 적용된다.
const marked = renderInlineMarkdown("**굵게** [[a **b** `c`]] `코드`");
assert.ok(marked.includes('data-link="a **b** `c`"'), marked);
assert.ok(marked.startsWith("<strong>굵게</strong> "), marked);
assert.ok(marked.endsWith('<code class="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">코드</code>'), marked);
assert.ok(!/<a[^>]*<strong>/.test(marked) && !/<a[^>]*<code/.test(marked), marked);
assert.ok(renderInlineMarkdown("**[[노트]] 굵게**").startsWith("<strong><a "));
assert.equal(renderInlineMarkdown("\uE0000\uE001"), "0");
const editLine = "x [[/폴더/노트]]  y";
const editLink = parseWikilinks(editLine)[0];
for (const cursor of [editLink.from - 1, editLink.from, editLink.from + 2, editLink.to, editLink.to + 1]) {
  assert.equal(isWikilinkEditPosition(editLine, editLink, cursor), true, `edit cursor ${cursor}`);
}
for (const cursor of [editLink.from - 2, editLink.to + 2]) {
  assert.equal(isWikilinkEditPosition(editLine, editLink, cursor), false, `render cursor ${cursor}`);
}
const compactLine = "x[[노트]]y";
const compactLink = parseWikilinks(compactLine)[0];
assert.equal(isWikilinkEditPosition(compactLine, compactLink, compactLink.from - 1), false);
assert.equal(isWikilinkEditPosition(compactLine, compactLink, compactLink.to + 1), false);
console.log("PASS: wikilink resolution, creation, title-only display, preserved targets, HTML escaping");
