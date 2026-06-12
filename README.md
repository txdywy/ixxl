# Elemental Rift

一个纯静态前端的 3D 消消乐原型：Three.js 负责棋盘、宝石、粒子和后期光效，DOM 负责 HUD 与菜单。玩法围绕冰、火、雷、森、日、虚空六类元素展开，支持桌面鼠标和移动端触控。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物输出到 `dist/`。仓库内已经包含 GitHub Actions 工作流，会在 `main` 分支推送后构建并部署到 GitHub Pages。

## 操作

- 点击或触摸一个元素，再点击相邻元素进行交换。
- 连成 3 个或更多同类元素会消除并触发 3D 粒子特效。
- 4 连、5 连会留下更强的特殊元素。
- 达成每关目标分数即可进入下一关。

## 视觉参考

项目内的 `concept-elemental-board.png` 是本次生成的美术方向参考图。
