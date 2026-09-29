# create-geshu

交互创建项目：

```sh
npx create-geshu@latest
```

也可以通过参数选择模板和项目名称，例如：

```sh
npx create-geshu@latest --type nextjs-shadcn --name my-app --no-local-license
npx create-geshu@latest --framework nextjs --ui shadcn --tailwind 4 --name my-app
npx create-geshu@latest --type vercel-supabase --name my-cloud-app
```

## Vercel + Supabase 模板

`--type vercel-supabase` 创建 `geshu-vercel-supabase-template` 的下游项目，使用 Next.js、shadcn、TailwindCSS 4 和 Supabase。别名包括 `supabase`、`nextjs-vercel-supabase`、`next-vercel-supabase` 和 `12`。

也可以使用分项参数：

```sh
npx create-geshu@latest --framework nextjs --ui shadcn --tailwind 4 --deployment vercel-supabase --name my-cloud-app
```

交互选择 Next.js + shadcn + TailwindCSS 4 后会询问部署方式；默认保留原模板。非交互调用省略 `--deployment` 时仍选原模板。`--deployment default` 可显式选择原模板，其他框架/UI/Tailwind 组合不支持 `vercel-supabase`。`--type` 不能与分项选择参数混用。

云模板保留受版本管理的 `pnpm-lock.yaml`、`supabase/config.toml` 和 SQL 迁移历史，不生成 Prisma 迁移、不安装依赖、不连接数据库，也不初始化离线授权。`--local-license` 不适用；`--no-local-license` 可兼容传入。

创建后按照项目 README 配置 Supabase 和 Vercel，再通过 Git 平台集成部署。脚手架不会替你创建云项目或应用数据库迁移。本地开发使用模板固定的 pnpm：先配置 README 中的环境变量，再运行 `pnpm install --frozen-lockfile` 和 `pnpm dev`。

## Prisma Next.js 模板初始化

`nextjs`、`nextjs-shadcn`、`nextjs-shadcn-t3` 从自己的 `package.json` 读取 Prisma 版本范围，下载相应版本的 CLI，基于当前 schema 生成项目独立的初始迁移。首次下载需要网络，等待期间会显示阶段、版本范围和已用时间。

包管理器检测和命令映射使用 [package-manager-detector](https://github.com/antfu-collective/package-manager-detector)，优先读取启动脚手架时的包管理器信息。直接使用 Node 启动、没有启动信息时，再检查启动目录的 `packageManager`、`devEngines.packageManager` 和锁文件；都未检测到时默认使用 npm。不会根据克隆下来的模板切换包管理器。

| 启动时的包管理器 | Prisma 执行方式                                        |
| ---------------- | ------------------------------------------------------ |
| npm / npx        | `npx --yes --package prisma@<模板版本范围> prisma ...` |
| pnpm             | `pnpm dlx prisma@<模板版本范围> ...`                   |
| Yarn 2+          | `yarn dlx prisma@<模板版本范围> ...`                   |
| Bun              | `bun x prisma@<模板版本范围> ...`                      |
| Yarn 1           | 明确提示后使用检测库的 `npx` 兼容方式                  |

Yarn 2+ 执行 Prisma 时，临时使用 `node-modules` 安装模式，避免 Windows 下的 PnP 加载兼容问题；不会修改项目的 Yarn 配置。

创建过程不会安装整个项目的依赖，也不会创建或修改业务数据库。初始 SQL 和 `migration_lock.toml` 会纳入项目的 `feat: init` 提交。

创建后进入项目，使用自己的包管理器安装依赖，再执行：

```sh
npm run db:dev
npm run dev
```

上面以 npm 为例，CLI 输出的安装、初始化和启动命令会跟随检测到的包管理器。

命令失败或取消时保留项目目录，并指出失败阶段。请检查保留的文件后手工完成初始化，或换一个不存在的项目目录重新创建；脚手架不会覆盖已有项目。

## 本地授权

使用 Prisma 的三个 Next.js 模板会询问“是否开启本地授权？”，默认关闭。这里指部署时的本地离线许可证，不是账号登录；本地开发仍沿用模板的 `mock` 模式。Vercel + Supabase 模板没有此询问和能力。

- `--no-local-license`：跳过询问，移除新项目中的 `license/`，业务打包使用无授权模式。授权相关应用代码和维护脚本仍保留。
- `--local-license`：跳过开关询问，立即进入模板授权向导。需要交互终端，使用已有统一签发材料，或导入已签好的当前项目策略。
- 不传开关：交互终端默认选择关闭；非交互环境直接关闭。

开启时保留模板通用 Agent，重新生成与项目名称和主版本匹配的策略、安装脚本及清单。签名、Agent 和交付文件校验全部通过后才纳入初始化提交。取消向导或缺少材料会停止创建，不会沿用模板策略或自动切换为关闭。

脚手架不会生成签发私钥或签发客户许可证。签发私钥保存在项目外的现有签发目录，通过 `GESHU_LICENSE_ISSUER_DIR` 指定，或使用模板默认目录。

## 开发验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:templates
pnpm test:package-managers
```

模板集成验证会在系统临时目录克隆三个当前 Next 模板，运行打包后的 CLI，并用内存 SQLite 验证迁移。授权场景只使用临时测试签发材料，不访问真实私钥，不生成镜像或发布。

`pnpm test` 包含云模板的本地 Git fixture 集成验证，无需访问新模板的 GitHub 仓库或真实 Supabase 项目，覆盖锁文件/迁移原样保留、正确的模板远程仓库和初始化提交，以及旧模板选择兼容性。

包管理器集成验证需要 PATH 中可执行的 npm、pnpm、Bun 和 Yarn 2+，会分别下载并执行模板版本的 Prisma，验证含空格路径、SQL 可执行性，以及项目中没有产生依赖、数据库或锁文件；还会通过 Yarn PnP 启动本地打包产物，验证完整创建流程。
