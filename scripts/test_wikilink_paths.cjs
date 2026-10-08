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
const { buildLinkCandidates, resolveLink, newLinkTarget, linkCreationLocation } = context.exports;
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
console.log("PASS: frontend absolute/legacy paths, ambiguity, nested folders, reserved characters, creation locations");
