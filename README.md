# 万卷图 · Campura Map Studio

CampuraOne_School_CamapComposer 是独立的二维校园地图桌面编辑器，使用 **Tauri 2 + React + TypeScript + Konva**。Windows 为发布目标，macOS 支持本机预览。没有 3D、室内定位或楼层内自动导航。

## 先试用

1. 启动万卷图，内置地图明确标为演示，尚未绑定真实地理位置。
2. 选择「建筑」或「商户」，拖出矩形。选择工具下可拖动、缩放、旋转或调整顶点。
3. 选择建筑管理楼层；底部手动切换楼层。
4. 选择「门」点击放置，设置所属建筑/商户、门宽和是否通向室外。
5. 选择「楼梯」点击放置，选择所属建筑，勾选实际可达楼层。
6. 选择「路点」放置室外节点，再用「道路」依次连接；门可创建关联入口路点。右侧可试算室外路线。
7. 「导出 .camap」保存文件，在学校端「控制台 → 校园地图」上传，检查差异，再发布。
8. 后续修改优先从学校端下载当前主地图后打开，以保留合并所需的基准版本。

浏览器预览使用下载；桌面版使用系统打开/保存对话框。自动恢复副本只保留当前工程，重要工程请导出备份。撤销/重做使用 Ctrl/Cmd+Z 与 Shift+Ctrl/Cmd+Z，保存 Ctrl/Cmd+S，V 选择，H 漫游，Esc 结束连线。

## 开发启动

将 SDK 仓库放在旁边：

```text
Web-学校端/
  CampuraOne_Camap/                 # 独立格式规范仓库
  CampuraOne_Camap_SDK/             # 独立 SDK 仓库
  CampuraOne_School_CamapComposer/  # 本仓库
  CampuraOne_School_Web/
```

Node 22.18+、Rust stable，以及 Tauri 对应平台的系统依赖：

```sh
cd ../CampuraOne_Camap_SDK/typescript
npm ci
npm run build
cd ../../CampuraOne_School_CamapComposer
npm ci
npm test
npm run desktop
```

只预览界面：`npm run dev`，地址 http://127.0.0.1:1420 。网页预览不代替原生安装测试。

## 安装包

`npm run desktop:build` 在当前平台生成安装包。Windows 需要 Visual Studio C++ Build Tools 与 WebView2；请在 Windows 构建、安装并复验打开/保存、缩放和导出，macOS 构建不证明 Windows 已通过。安装产物在 `src-tauri/target/release/bundle/`，不要提交构建目录。当前本机版本未做 Apple 公证或 Windows 代码签名。

学校端下载入口由 `VITE_CAMAP_EDITOR_DOWNLOAD_URL`（演示）或 `CAMPURA_CAMAP_EDITOR_URL`（服务端）指定。将核验后的对应平台安装包放在自己的发布地址；源代码不会自动向生产站点部署。

## 真实底图

「设置底图」接入高德 Web JS 2D，填写自己的 Web JS Key、安全代理地址以及区域原点的高德经纬度。安全密钥仅供开发调试；正式使用应部署高德安全代理并配置域名白名单。Key 只保存在本次运行的内存，不进入 .camap。

未提供可用 Key 时可完整编辑本地米制平面，但不能声称已与真实校园对齐。当前未验证用户实际 Key 在 Tauri WebView 中的授权行为；若服务商要求网页域名，需提供同域托管的地图桥接页面后联调。MapKit 仅保留独立绑定的数据接口，当前编辑器没有加载 MapKit 底图。不会把同一对经纬度当成两家地图通用坐标。

## 源码入口

- `src/App.tsx`：工具、画布、楼层、属性编辑与撤销
- `src/model.ts`：新增、移动、级联删除与入口路点同步
- `src/amap.ts`：二维底图与坐标适配
- `src/files.ts`：浏览器与桌面文件接口
- `src-tauri/src/main.rs`：系统文件选择器、大小限制、同目录临时文件保存

首版用于小范围校园编辑。大批量地标尚未做空间索引、视口裁剪和大图性能验收；超过 10 km 的区域应创建独立坐标框架。多框架没有默认连通路线。
