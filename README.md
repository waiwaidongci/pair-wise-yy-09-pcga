# Token Forge 设计令牌工作台

基于 SolidJS、TypeScript、Vite、Kobalte、Tailwind CSS、Solid Router 和 Style Dictionary 的本地设计令牌工作台。

## 运行

```bash
corepack pnpm install
corepack pnpm dev
```

生产构建：

```bash
corepack pnpm build
corepack pnpm tokens:build
```

## 已实现功能

- 管理颜色、字号、间距、圆角、阴影和动效时长令牌。
- 多套主题切换、复制和本地持久化。
- 编辑令牌后组件预览实时刷新。
- 自动计算正文与关键颜色组合的 WCAG 对比度等级。
- 保存修改快照并比较两次修改之间的差异。
- 导入 JSON，导出 Style Dictionary JSON、CSS Variables 和 Sass Variables。
- `tokens:build` 使用 Style Dictionary 输出 CSS、SCSS 和扁平 JSON。
