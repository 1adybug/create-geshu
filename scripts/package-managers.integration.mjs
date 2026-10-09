import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import crossSpawn from "cross-spawn"

import { runCommand } from "../commands.ts"
import { initializeNextJsPrismaMigration } from "../nextjs.ts"

for (const manager of [
    { name: "npm", agent: "npm" },
    { name: "pnpm", agent: "pnpm" },
    { name: "bun", agent: "bun" },
    { name: "yarn", agent: "yarn@berry" },
]) {
    test(`${manager.name}: real Prisma CLI produces executable SQL without project dependencies`, { timeout: 180_000 }, async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-manager-smoke "))

        t.after(async () => {
            assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()))
            assert(path.basename(root).startsWith("create-geshu-manager-smoke "))
            await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        })

        await fs.mkdir(path.join(root, "prisma"))
        const packageJson = JSON.stringify({ name: "migration-example", private: true, devDependencies: { prisma: "7.10.0" } })
        await fs.writeFile(path.join(root, "package.json"), packageJson)
        await fs.writeFile(path.join(root, "prisma.config.ts"), 'export default { datasource: { url: "file:./data/development.db" } }')
        await fs.writeFile(
            path.join(root, "prisma/schema.prisma"),
            'datasource db {\n provider = "sqlite"\n}\nmodel Example {\n id String @id\n name String @unique\n}\n',
        )
        await initializeNextJsPrismaMigration(root, manager, (command, args, cwd, options) =>
            runCommand(
                command,
                // 隔离 dlx 缓存和 store，并禁用全局依赖复用，覆盖首次下载时的引擎构建。
                manager.name === "pnpm"
                    ? [
                          `--config.cache-dir=${path.join(root, "pnpm-cache")}`,
                          `--config.store-dir=${path.join(root, "pnpm-store")}`,
                          "--config.enable-global-virtual-store=false",
                          ...args,
                      ]
                    : args,
                cwd,
                {
                    ...options,
                    // 模拟通过 npm exec --package 启动脚手架，不能让 Prisma 继承执行外层包。
                    env: { ...options.env, npm_config_package: "create-geshu@0.5.0" },
                },
            ))

        if (manager.name === "pnpm") {
            assert((await fs.stat(path.join(root, "pnpm-cache/dlx"))).isDirectory())
            assert((await fs.stat(path.join(root, "pnpm-store"))).isDirectory())
        }

        const database = new DatabaseSync(":memory:")

        try {
            database.exec(await fs.readFile(path.join(root, "prisma/migrations/0_init/migration.sql"), "utf8"))
            database.prepare("INSERT INTO Example (id, name) VALUES (?, ?)").run("1", "example")
            assert.throws(() => database.prepare("INSERT INTO Example (id, name) VALUES (?, ?)").run("2", "example"), /UNIQUE constraint/)
        } finally {
            database.close()
        }

        assert.equal(await fs.stat(path.join(root, "node_modules")).catch(() => null), null)
        assert.equal(await fs.stat(path.join(root, "data")).catch(() => null), null)
        assert.equal(await fs.readFile(path.join(root, "package.json"), "utf8"), packageJson)
        for (const file of ["package-lock.json", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-workspace.yaml", ".npmrc"])
            assert.equal(await fs.stat(path.join(root, file)).catch(() => null), null)
    })
}

test("Yarn launcher: packed CLI starts under PnP and keeps Yarn for Prisma", { timeout: 180_000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-yarn-launch "))

    t.after(async () => {
        assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()))
        assert(path.basename(root).startsWith("create-geshu-yarn-launch "))
        await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    })

    const repository = fileURLToPath(new URL("..", import.meta.url))

    const packed = crossSpawn.sync("npm", ["pack", "--ignore-scripts", "--pack-destination", root, "--json"], {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
    })

    assert.equal(packed.status, 0, `${packed.error ?? ""}\n${packed.stdout}\n${packed.stderr}`)
    const archive = path.join(root, JSON.parse(packed.stdout)[0].filename).replaceAll("\\", "/")

    const launched = crossSpawn.sync(
        "yarn",
        ["dlx", "--package", `create-geshu@file:${archive}`, "create-geshu", "--type", "nextjs-shadcn", "--name", "yarn-example", "--no-local-license"],
        {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
            timeout: 120_000,
            env: {
                ...process.env,
                YARN_NODE_LINKER: "pnp",
                GIT_AUTHOR_NAME: "create-geshu integration",
                GIT_AUTHOR_EMAIL: "create-geshu@example.invalid",
                GIT_COMMITTER_NAME: "create-geshu integration",
                GIT_COMMITTER_EMAIL: "create-geshu@example.invalid",
                HUSKY: "0",
            },
        },
    )

    const output = `${launched.stdout}\n${launched.stderr}`
    assert.equal(launched.status, 0, `${launched.error ?? ""}\n${output}`)
    assert.match(output, /> yarn dlx prisma@/)
    assert.match(output, /创建完成: yarn-example/)
    assert.match(output, /yarn install，yarn run db:dev，yarn run dev/)
    assert.equal(await fs.stat(path.join(root, "yarn-example/node_modules")).catch(() => null), null)
})
