import { CollabWorkspace } from "./workspace";

let workspace: CollabWorkspace | undefined;

/** 浏览器内的单例工作台：localStorage 模拟多个窗口共享的服务端，storage 事件做跨窗同步。 */
export function useWorkspace(): CollabWorkspace {
  if (!workspace) {
    workspace = new CollabWorkspace({
      storage: window.localStorage,
      session: window.sessionStorage,
      onStorageEvent: (cb) => {
        window.addEventListener("storage", (event) => {
          if (event.key) cb(event.key);
        });
      },
      onHide: (cb) => {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible") cb();
        });
        window.addEventListener("pagehide", cb);
      },
    });
    // 跟随真实网络：浏览器触发 online/offline 时自动续作合并或暂停。
    window.addEventListener("online", () => workspace?.setOnline(true));
    window.addEventListener("offline", () => workspace?.setOnline(false));
  }
  return workspace;
}
