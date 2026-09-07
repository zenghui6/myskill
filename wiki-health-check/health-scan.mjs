#!/usr/bin/env node
// wiki-health-check Phase-1 快扫脚本（Node 零依赖）
// 用法: node health-scan.mjs <知识库根目录> [代码仓库目录]
// 输出: 索引失真 / 主题聚簇 / 过时基线 / 交叉引用 四项结构检查的精简清单
// 豁免: knowledge-graph generated work-log wiki-health glossary 及 INDEX.md 本身
// Windows 注意: git 通过 execFileSync 直调, 不经 shell, 不受 PATH 中 WSL bash 存根影响
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

const KB = process.argv[2];
if (!KB) { console.error("用法: node health-scan.mjs <知识库根目录> [代码仓库目录]"); process.exit(1); }
const REPO = process.argv[3] || KB;
const SCAN_DIRS = ["design", "bug", "orientation", "api", "scan"];
const EXCLUDE = new Set(["knowledge-graph", "generated", "work-log", "wiki-health", "glossary", "node_modules"]);
const today = new Date().toISOString().slice(0, 10);

// ---------- 工具 ----------
function listDocs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!EXCLUDE.has(name)) out.push(...listDocs(p)); }
    else if (name.endsWith(".md") && name !== "INDEX.md") out.push(p);
  }
  return out;
}
function gitCountSince(epoch, paths) {
  let n = 0;
  for (const p of paths) {
    if (!existsSync(join(REPO, p))) continue;
    try {
      const r = execFileSync("git", ["-C", REPO, "log", `--since=@${epoch}`, "--oneline", "--", p],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      n += r.trim() ? r.trim().split("\n").length : 0;
    } catch { /* git 不可用时静默跳过 */ }
  }
  return n;
}

console.log(`# wiki-health 快扫 · ${basename(KB)} · ${today}\n`);

// ---------- 检查项 1: 索引失真 ----------
console.log("## 必处理: 索引失真");
let found1 = 0;
for (const t of SCAN_DIRS) {
  const dir = join(KB, t);
  if (!existsSync(dir)) continue;
  const idxPath = join(dir, "INDEX.md");
  if (!existsSync(idxPath)) { console.log(`- ${t}/INDEX.md 不存在`); found1++; continue; }
  const idx = readFileSync(idxPath, "utf8");
  for (const f of listDocs(dir)) {
    let b = basename(f, ".md");
    if (b.endsWith("-current")) b = b.slice(0, -"-current".length);
    if (!idx.includes(b)) { console.log(`- [${t}] 文件未登记: ${b}`); found1++; }
  }
  // INDEX 中 文件：`xxx/yyy.md` 行指向不存在的路径 → 死条目
  for (const m of idx.matchAll(/文件：`([^`]+)`/g)) {
    const rel = m[1].replace(/\s+/g, "");
    if (!existsSync(join(dir, rel))) { console.log(`- [${t}] 死条目: ${rel}`); found1++; }
  }
}
if (!found1) console.log("- (无)");
console.log("");

// ---------- 检查项 2: 跨目录主题聚簇 ----------
console.log("## 建议: 跨目录主题聚簇");
let found2 = 0;
const dirTitles = []; // {dir, title}
for (const t of SCAN_DIRS) {
  const idxPath = join(KB, t, "INDEX.md");
  if (!existsSync(idxPath)) continue;
  for (const line of readFileSync(idxPath, "utf8").split("\n")) {
    const m = line.match(/^##\s+(.*)/);
    if (m && !/文档索引/.test(m[1])) dirTitles.push({ dir: t, title: m[1].trim() });
  }
}
// 标题切词: 中文/字母连续 2+ 字符片段; 统计出现在 >=2 个子目录的词
const tokenDirs = new Map();
for (const { dir, title } of dirTitles) {
  for (const w of title.match(/[\u4e00-\u9fa5a-zA-Z]{2,}/g) || []) {
    if (!tokenDirs.has(w)) tokenDirs.set(w, new Set());
    tokenDirs.get(w).add(dir);
  }
}
const clustered = [...tokenDirs.entries()]
  .filter(([w, dirs]) => dirs.size >= 2 && w.length >= 2)
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 20);
for (const [w, dirs] of clustered) {
  console.log(`- 关键词「${w}」命中目录: ${[...dirs].join(",")}`);
  for (const { dir, title } of dirTitles) if (title.includes(w)) console.log(`    ${dir}|${title}`);
  found2++;
}
if (!found2) console.log("- (无)");
console.log("");

// ---------- 检查项 3: 过时基线 ----------
console.log("## 建议: 过时基线");
let found3 = 0;
for (const t of SCAN_DIRS) {
  const dir = join(KB, t);
  if (!existsSync(dir)) continue;
  for (const f of listDocs(dir)) {
    let title = basename(f, ".md");
    if (title.endsWith("-current")) title = title.slice(0, "-current".length * -1 + title.length); // noop guard
    title = basename(f, ".md").replace(/-current$/, "");
    const text = readFileSync(f, "utf8");
    const paths = [...new Set(text.match(/(?:src\/(?:main|test))\/[\w/]+\.java/g) || [])].slice(0, 10);
    if (!paths.length) continue;
    const mtime = Math.floor(statSync(f).mtimeMs / 1000);
    const newer = gitCountSince(mtime, paths);
    if (newer > 0) {
      console.log(`- [${t}/${title}] 落笔后相关代码有 ${newer} 次提交`);
      found3++;
    }
  }
}
if (!found3) console.log("- (无)");
console.log("");

// ---------- 检查项 4: 交叉引用 ----------
console.log("## 提示: 交叉引用");
let allDocs = [], xref = 0;
for (const t of SCAN_DIRS) {
  const dir = join(KB, t);
  if (!existsSync(dir)) continue;
  for (const f of listDocs(dir)) {
    allDocs.push(f);
    if (/\]\([^)]*\.md\)/.test(readFileSync(f, "utf8"))) xref++;
  }
}
console.log(`- 互链文档数 ${xref} / 手写文档总数 ${allDocs.length}`);
console.log("");
console.log("## 豁免");
console.log("- knowledge-graph/ generated/ work-log/ wiki-health/ glossary/ 与各 INDEX.md");
