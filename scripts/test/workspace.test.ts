import { CollabWorkspace } from "../../src/collab/workspace";
import { MemoryBus, MemoryStorage, asyncTimers } from "./harness";
import { STATE_KEY, outboxKey } from "../../src/collab/storage";

let failures = 0;
let passes = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (condition) passes += 1;
  else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}
function section(name: string): void {
  console.log(`\n${name}`);
}

async function flush(): Promise<void> {
  // 合并去抖 180ms + 抢锁重试 240ms，留出两拍。
  await new Promise((resolve) => setTimeout(resolve, 520));
}

interface EnvOptions {
  storage: MemoryStorage;
  bus: MemoryBus;
  clientId?: string;
  session?: MemoryStorage;
  now?: () => number;
}

function openWindow({ storage, bus, clientId, session, now }: EnvOptions): CollabWorkspace {
  return new CollabWorkspace({
    storage,
    session: session ?? new MemoryStorage(),
    bus,
    clientId,
    now,
    ...asyncTimers(),
  });
}

function tokenValue(workspace: CollabWorkspace, tokenId: string): string | undefined {
  for (const tokens of Object.values(workspace.activeTheme().tokens)) {
    const found = tokens.find((token) => token.id === tokenId);
    if (found) return found.value;
  }
  return undefined;
}

function draftValue(workspace: CollabWorkspace, tokenId: string): string | undefined {
  for (const tokens of Object.values(workspace.draftTheme().tokens)) {
    const found = tokens.find((token) => token.id === tokenId);
    if (found) return found.value;
  }
  return undefined;
}

// 1. 两个窗口离线改同一主题不同令牌 → 恢复后都进入确认版本。
section("端到端：两窗口离线改动，恢复后逐令牌合并");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.setOnline(false);
  b.setOnline(false);

  a.updateToken("color", "color-brand", { value: "#aaaaaa" });
  b.updateToken("color", "color-danger", { value: "#bbbbbb" });

  assert(draftValue(a, "color-brand") === "#aaaaaa", "A 草稿立即反映本地改动");
  assert(tokenValue(a, "color-brand") !== undefined && a.activeTheme().tokens.color.find((t) => t.id === "color-brand")!.value !== "#aaaaaa", "但确认版本仍是旧值");
  assert(a.localPendingOps().length === 1, "A 的待处理改动已记录窗口与基线");

  a.setOnline(true);
  b.setOnline(true);
  await flush();

  assert(tokenValue(a, "color-brand") === "#aaaaaa", "A 改动进入确认版本");
  assert(tokenValue(a, "color-danger") === "#bbbbbb", "B 改动也进入确认版本，不被整份保存覆盖");
  assert(a.activeThemeId() === "theme-light", "主题身份未变");
  assert(a.localPendingOps().length === 0 && b.localPendingOps().length === 0, "两边待处理队列清空");
  assert((a.revisions()["theme-light"]?.length ?? 0) === 2, "确认修订前进且旧修订保留");
}

// 2. 同值冲突并排 → 裁决 → 新快照依据；旧快照保留。
section("端到端：冲突并排 → 裁决生成新快照，旧快照保留");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.saveSnapshot("基线快照");
  a.setOnline(false);
  b.setOnline(false);
  a.updateToken("color", "color-brand", { value: "#aaaaaa" });
  b.updateToken("color", "color-brand", { value: "#bbbbbb" });
  a.setOnline(true);
  b.setOnline(true);
  await flush();

  assert(a.conflicts().length === 1, "存在 1 个待裁决冲突");
  assert(tokenValue(a, "color-brand") === "#356ae6", "未裁决时主题仍指向上一份确认版本");

  const bProposal = a.conflicts()[0].proposals.find((p) => p.clientId === "c2")!;
  a.setResolution(a.conflicts()[0].id, { type: "proposal", opId: bProposal.opId });
  await flush();

  assert(tokenValue(a, "color-brand") === "#bbbbbb", "裁决后采用 B 方案");
  const snapshots = a.snapshots();
  assert(snapshots[0].label.includes("协作裁决提交"), "裁决提交生成新快照");
  assert(snapshots.some((s) => s.label === "基线快照"), "旧快照保留");
  assert(snapshots[0].revision === 2 || snapshots[0].revision === 1, "新快照带修订号");
}

// 3. 移除与编辑冲突不会悄悄盖掉。
section("端到端：移除与编辑相撞，确认版本不动");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.setOnline(false);
  b.setOnline(false);
  a.removeToken("color", "color-muted");
  b.updateToken("color", "color-muted", { value: "#123123" });
  a.setOnline(true);
  b.setOnline(true);
  await flush();

  assert(a.conflicts().some((c) => c.conflictType === "remove-edit"), "挂出移除-编辑冲突");
  assert(tokenValue(a, "color-muted") === "#68738a", "确认版本保持旧值，没有被删或被改");
}

// 4. 合并失败 → 检查点恢复 → 改动仍在，可再次合并。
section("端到端：合并失败后从检查点恢复");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.setOnline(false);
  b.setOnline(false);
  a.updateToken("color", "color-brand", { value: "#aaaaaa" });
  b.updateToken("color", "color-danger", { value: "#bbbbbb" });
  a.setOnline(true);
  b.setOnline(true);
  a.armNextMergeFailure();
  await flush();

  assert(Boolean(a.mergeError()), "记录合并失败原因");
  assert(tokenValue(a, "color-brand") === "#356ae6", "失败后确认版本未被半成品写入");
  assert(storage.getItem(outboxKey("c1"))?.includes("#aaaaaa"), "检查点保留了 A 的待处理改动");
  assert(storage.getItem(outboxKey("c2"))?.includes("#bbbbbb"), "检查点保留了 B 的待处理改动");
  assert(Boolean(a.checkpoint()), "窗口持有可恢复检查点");

  a.recoverFromCheckpoint();
  assert(tokenValue(a, "color-brand") === "#356ae6", "恢复后确认版本回到检查点");
  assert(a.localPendingOps().length === 1, "恢复后本窗口待处理改动还在");
  assert(a.allPendingOps().length === 2, "两边待处理改动全部回来");

  await flush();
  // 恢复时已重新安排合并，去抖后两边改动安全续作：
  assert(tokenValue(a, "color-brand") === "#aaaaaa", "重新合并成功：A 改动进入确认版本");
  assert(tokenValue(a, "color-danger") === "#bbbbbb", "重新合并成功：B 改动进入确认版本");
  assert(!a.mergeError(), "失败状态清除");
}

// 5. 窗口重开：关闭后重开认领身份，待处理改动仍在。
section("端到端：窗口重开，待处理改动保留并可续作");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const session = new MemoryStorage();
  const first = openWindow({ storage, bus, clientId: "c1", session });
  first.setOnline(false);
  first.updateToken("color", "color-brand", { value: "#cccccc" });
  // 模拟窗口关闭：身份标记为 open=false。
  const closeClients = (id: string) => {
    const raw = JSON.parse(storage.getItem("token-forge-clients-v1")!);
    storage.setItem("token-forge-clients-v1", JSON.stringify(raw.map((c: any) => (c.id === id ? { ...c, open: false } : c))));
  };
  closeClients("c1");

  const reopened = openWindow({ storage, bus, session });
  assert(reopened.clientId === "c1", "重开后认领回原窗口身份");
  assert(reopened.localPendingOps().length === 1, "待处理改动随窗口身份回来");
  assert(reopened.draftTheme().tokens.color.find((t) => t.id === "color-brand")!.value === "#cccccc", "草稿仍显示离线改动");

  reopened.setOnline(true);
  await flush();
  assert(tokenValue(reopened, "color-brand") === "#cccccc", "恢复网络后续作合并成功");
}

// 5b. 两个真实窗口关闭再开，身份不串台。
section("端到端：多窗口并存时新窗口不抢占在线身份");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1", session: new MemoryStorage() });
  const b = openWindow({ storage, bus, clientId: "c2", session: new MemoryStorage() });
  const c = openWindow({ storage, bus, session: new MemoryStorage() });
  assert(c.clientId !== "c1" && c.clientId !== "c2", "A、B 仍在线时，新窗口拿到新身份");
  assert(a.localPendingOps().length === 0 && b.localPendingOps().length === 0, "已有窗口的待处理队列未被新窗口认领");
}

// 6. v1 数据升级：原主题与快照继续可用，基线修订为 0。
section("端到端：v1 数据升级");
{
  const storage = new MemoryStorage();
  const v1 = {
    themes: [
      {
        id: "theme-old",
        name: "老主题",
        tokens: {
          color: [{ id: "x", name: "x.y", value: "#010203", description: "旧令牌" }],
          fontSize: [],
          spacing: [],
          radius: [],
          shadow: [],
          motion: [],
        },
      },
    ],
    activeThemeId: "theme-old",
    snapshots: [
      { id: "s1", label: "历史快照", createdAt: "2020-01-01 10:00:00", theme: { id: "theme-old", name: "老主题", tokens: {} } },
    ],
  };
  storage.setItem("token-forge-workspace-v1", JSON.stringify(v1));

  const bus = new MemoryBus();
  const workspace = openWindow({ storage, bus });
  assert(workspace.activeTheme().id === "theme-old", "原主题继续可用");
  assert(workspace.activeTheme().name === "老主题", "原主题内容完整");
  assert(workspace.snapshots()[0].label === "历史快照", "旧快照继续可用");
  assert(workspace.snapshots()[0].revision === 0, "旧快照登记在第 0 修订");

  workspace.updateToken("color", "x", { value: "#ffffff" });
  await flush();
  assert(tokenValue(workspace, "x") === "#ffffff", "升级后的编辑正常走协作修订");
  const doc = JSON.parse(storage.getItem(STATE_KEY)!);
  assert(Array.isArray(doc.revisions["theme-old"]) && doc.revisions["theme-old"].length === 2, "修订链在旧主题上继续增长");
}

// 7. 草稿只影响编辑窗口：A 离线草稿不出现在 B 的确认视图中。
section("端到端：草稿窗口隔离，确认视图只读确认版本");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.setOnline(false);
  a.updateToken("color", "color-brand", { value: "#dead00" });

  assert(tokenValue(b, "color-brand") === "#356ae6", "B 的确认版本不受 A 的离线草稿影响");
  assert(b.localPendingOps().length === 0, "B 的待处理队列为空");
}

// 8. 只恢复一个窗口的网络：仍离线窗口的改动保留，不被提前消化。
section("端到端：单侧恢复网络，他窗离线改动不丢失");
{
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  const b = openWindow({ storage, bus, clientId: "c2" });
  a.setOnline(false);
  b.setOnline(false);
  a.updateToken("color", "color-brand", { value: "#aaaaaa" });
  b.updateToken("color", "color-danger", { value: "#bbbbbb" });

  // 只 A 恢复（它会读到 B 已落盘的待处理操作，但 B 仍处于离线意图中）。
  a.setOnline(true);
  await flush();

  assert(tokenValue(a, "color-brand") === "#aaaaaa", "A 的改动进入确认版本");
  assert(a.allPendingOps().some((op) => op.clientId === "c2"), "B 仍离线，其待处理操作保留");
  assert(tokenValue(a, "color-danger") === "#c53b4d", "B 尚未恢复，确认版本不含 B 的改动");

  b.setOnline(true);
  await flush();
  assert(tokenValue(b, "color-danger") === "#bbbbbb", "B 恢复后改动并入，无丢失");
  assert(b.allPendingOps().length === 0, "最终两边队列清空");
}

// 9. 浏览器真实网络事件：上线/下线自动跟随 navigator.onLine。
section("端到端：浏览器 online/offline 事件自动跟随（构造可注入）");
{
  // 该行为由 index.ts 绑定 window 事件保证；这里验证 workspace 可重复 setOnline 且幂等。
  const storage = new MemoryStorage();
  const bus = new MemoryBus();
  const a = openWindow({ storage, bus, clientId: "c1" });
  a.setOnline(false);
  a.setOnline(false);
  a.updateToken("color", "color-brand", { value: "#111111" });
  assert(a.localPendingOps().length === 1, "重复断网不产生重复状态问题");
  a.setOnline(true);
  a.setOnline(true);
  await flush();
  assert(tokenValue(a, "color-brand") === "#111111", "重复恢复只合并一次，结果正确");
}

console.log(`\n${passes} 通过, ${failures} 失败`);
setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50);
