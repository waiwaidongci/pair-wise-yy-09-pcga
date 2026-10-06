// 兼容层：组件统一改用 collab 的 useWorkspace；此文件保留为薄封装，便于老引用平滑迁移。
import { useWorkspace } from "../collab";

export function useTokenStore() {
  return useWorkspace();
}
