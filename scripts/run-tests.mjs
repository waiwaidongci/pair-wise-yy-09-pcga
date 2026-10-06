// 用 esbuild 把 TS 测试即时打包到临时目录后由 Node 运行，无需额外测试框架。
// 注意必须走 browser 条件解析 solid-js，否则在 node 条件下会命中非响应式的 server 构建。
import { build } from "esbuild";
import { rmSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = join(root, "scripts", "test");
const outDir = join(root, "node_modules", ".tmp", "collab-tests");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entries = readdirSync(testDir).filter((name) => name.endsWith(".test.ts")).map((name) => join(testDir, name));

await build({
  entryPoints: entries,
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["browser", "development"],
  target: "node20",
  outdir: outDir,
  logLevel: "warning",
});

// 每个套件在独立子进程运行，断言失败的 process.exit(1) 不会吞掉其他套件，
// 也能绕开测试桩里长寿命 interval 导致的进程不退出。
let suiteFailures = 0;
for (const name of readdirSync(outDir).filter((item) => item.endsWith(".js"))) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [join(outDir, name)], { stdio: "inherit", timeout: 30_000 });
  if (result.status !== 0) suiteFailures += 1;
}

console.log(`\n${"=".repeat(60)}\n${suiteFailures === 0 ? "全部套件通过" : `${suiteFailures} 个套件失败`}`);
process.exit(suiteFailures === 0 ? 0 : 1);
