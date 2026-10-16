# GitHub Pages 发布

游戏是静态页面，使用仓库内的 GitHub Actions 构建并发布，无需 Netlify。

## 首次开启

1. 打开 [仓库 Pages 设置](https://github.com/sunchao213/bjtu_treasure_hunt/settings/pages)。
2. 在 **Build and deployment → Source** 选择 **GitHub Actions**。
3. 打开 [发布工作流](https://github.com/sunchao213/bjtu_treasure_hunt/actions/workflows/deploy-pages.yml)，点击 **Run workflow**，选择 `main` 并运行。若已自动启动，等待该次运行即可。
4. 等待 `Deploy GitHub Pages` 完成并显示绿色勾，再访问 <https://sunchao213.github.io/bjtu_treasure_hunt/>。

只有部署完成后，新网址才可使用。以后推送 `main` 会自动检查和发布；检查失败时不会发布该版本。在 Actions 的失败步骤中查看原因。

## 发布内容

- 运行 `npm ci` 和 `npm run check`，检查格式、ESLint、TypeScript、测试和生产构建。
- 上传并发布 `dist/`，无需手动上传源码或提交构建产物。
- Vite 使用相对路径，支持 `/bjtu_treasure_hunt/` 子目录和怪物图片加载。
- Netlify 旧网址不会随 GitHub Pages 更新。迁移后使用新的 GitHub Pages 网址。

## 存档迁移

浏览器存档按网站地址隔离。更换网址后，旧网站的仓库与图鉴不会自动转移。先在旧网站的“存档管理”导出 JSON 备份并保留旧网站数据；当前界面提供导出和重置，尚无导入入口。
