import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

import crossSpawn from "cross-spawn"

import { runCommand } from "../commands.ts"
import { configureNextJsLicense, validateNextJsLicense } from "../nextjs.ts"

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url))

const gitEnvironment = {
    GIT_AUTHOR_NAME: "create-geshu integration",
    GIT_AUTHOR_EMAIL: "create-geshu@example.invalid",
    GIT_COMMITTER_NAME: "create-geshu integration",
    GIT_COMMITTER_EMAIL: "create-geshu@example.invalid",
    HUSKY: "0",
}

async function command(executable, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = crossSpawn(executable, args, {
            cwd,
            // 独立测试进程不能继承当前 node:test 的执行标记。
            env: { ...process.env, ...gitEnvironment, NODE_TEST_CONTEXT: undefined },
            stdio: ["ignore", "pipe", "pipe"],
        })

        let output = ""

        child.stdout.on("data", chunk => {
            output += chunk
        })

        child.stderr.on("data", chunk => {
            output += chunk
        })

        child.once("error", reject)
        child.once("close", code => (code === 0 ? resolve(output) : reject(new Error(`${executable} ${args.join(" ")} failed (${code}):\n${output}`))))
    })
}

async function assertScaffold(project, licensed) {
    assert.equal(await fs.stat(path.join(project, "node_modules")).catch(() => null), null)
    const dataFiles = await fs.readdir(path.join(project, "data")).catch(() => [])
    assert(!dataFiles.some(name => name.endsWith(".db")))
    const migration = await fs.readFile(path.join(project, "prisma/migrations/0_init/migration.sql"), "utf8")
    const database = new DatabaseSync(":memory:")

    try {
        database.exec(migration)

        const tables = database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map(row => row.name)

        for (const name of ["user", "session", "account", "verification", "OperationLog", "ErrorLog", "SystemSetting"]) assert(tables.includes(name))
        assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
        database
            .prepare('INSERT INTO "user" (id, updatedAt, name, nickname, email, phoneNumber) VALUES (?, ?, ?, ?, ?, ?)')
            .run("user-1", Date.now(), "tester", "Tester", "test@example.invalid", "13000000000")
        database
            .prepare('INSERT INTO "account" (id, accountId, providerId, userId, updatedAt) VALUES (?, ?, ?, ?, ?)')
            .run("account-1", "external-1", "test-provider", "user-1", Date.now())
        assert.throws(
            () =>
                database
                    .prepare('INSERT INTO "account" (id, accountId, providerId, userId, updatedAt) VALUES (?, ?, ?, ?, ?)')
                    .run("account-2", "external-1", "test-provider", "user-1", Date.now()),
            /UNIQUE constraint/,
        )
    } finally {
        database.close()
    }

    assert.equal((await command("git", ["status", "--porcelain"], project)).trim(), "")
    assert.equal((await command("git", ["log", "-1", "--format=%s"], project)).trim(), "feat: init")
    assert((await command("git", ["ls-files", "prisma/migrations"], project)).includes("0_init/migration.sql"))
    assert.equal((await command("git", ["remote", "get-url", "--push", "template"], project)).trim(), "no_push://template")
    assert.equal(Boolean(await fs.stat(path.join(project, "license")).catch(() => null)), licensed)
    assert(!(await command("git", ["ls-files"], project)).includes("issuer.key"))
}

async function wizard(project, issuer, confirmation = "y") {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(project, "scripts/packageDeployment.mjs"), "license"], {
            cwd: project,
            env: { ...process.env, GESHU_LICENSE_ISSUER_DIR: issuer },
            stdio: ["pipe", "pipe", "pipe"],
        })

        let output = ""

        const answers = [
            { prompt: "请选择（默认：1）：", answer: "1" },
            { prompt: "确认更新 license 目录（完成后需提交 Git） [Y/n]：", answer: confirmation },
        ]

        const timeout = setTimeout(() => {
            child.kill()
            reject(new Error(`授权向导等待超时:\n${output}`))
        }, 30_000)

        child.stdout.on("data", chunk => {
            output += chunk
            if (answers.length && output.includes(answers[0].prompt)) child.stdin.write(`${answers.shift().answer}\n`)
        })

        child.stderr.on("data", chunk => {
            output += chunk
        })

        child.once("error", error => {
            clearTimeout(timeout)
            reject(error)
        })

        child.once("close", code => {
            clearTimeout(timeout)
            child.stdin.destroy()

            if (code === 0) resolve(output)
            else reject(new Error(`授权向导失败 (${code}):\n${output}`))
        })
    })
}

test("current Next templates: packaged CLI, executable migrations, and license wizard", { timeout: 300_000 }, async t => {
    await fs.access(entry)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-smoke "))

    t.after(async () => {
        assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()))
        assert(path.basename(root).startsWith("create-geshu-smoke "))
        await fs.rm(root, { recursive: true, force: true })
    })

    for (const type of ["nextjs", "nextjs-shadcn", "nextjs-shadcn-t3"]) {
        await t.test(`${type}: default disabled`, async () => {
            const output = await command(process.execPath, [entry, "--type", type, "--name", type], root)
            assert(output.includes("创建完成"), output)
            assert(output.includes("本地授权: 关闭"), output)
            const project = path.join(root, type)
            await assertScaffold(project, false)
            const tests = await command(process.execPath, ["--test", "scripts/licenseAgentArtifact.test.mjs", "scripts/deploymentPackages.test.mjs"], project)
            assert.match(tests, /当前项目未启用离线授权/)
            assert.match(tests, /没有 license 目录时自动生成无授权业务包/)
            await fs.mkdir(path.join(project, "license"))

            try {
                await assert.rejects(
                    command(process.execPath, ["--test", "--test-name-pattern=模板内置 Agent", "scripts/licenseAgentArtifact.test.mjs"], project),
                    /ENOENT/,
                )
            } finally {
                await fs.rmdir(path.join(project, "license"))
            }

            await assertScaffold(project, false)
            console.log(`${type}: 初始 SQL 可执行、账号唯一索引有效、无授权项目的 Agent 与部署测试通过、未安装依赖、未创建数据库、初始化提交完整。`)
        })
    }

    const project = path.join(root, "licensed-example")
    const issuer = path.join(root, "temporary-issuer")
    await t.test("packaged CLI initializes licensing through the actual template wizard", async () => {
        const { main } = await import(pathToFileURL(entry).href)
        const previousCwd = process.cwd()
        const previousExitCode = process.exitCode
        const descriptors = [process.stdin, process.stdout].map(stream => Object.getOwnPropertyDescriptor(stream, "isTTY"))
        for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, "isTTY", { configurable: true, value: true })
        process.chdir(root)

        try {
            await main(["--type", "nextjs-shadcn", "--name", "licensed-example", "--local-license"], async (executable, args, cwd, options) => {
                if (executable === process.execPath && args[0] === path.join(project, "scripts/packageDeployment.mjs")) {
                    const { createSharedIssuerFixture } = await import(pathToFileURL(path.join(project, "scripts/fixtures/sharedIssuer.mjs")).href)
                    const { createAgentArtifactFixture } = await import(pathToFileURL(path.join(project, "scripts/fixtures/licenseAgentArtifact.mjs")).href)
                    await createSharedIssuerFixture(issuer)
                    const publicKey = await fs.readFile(path.join(issuer, "trust.pub"), "utf8")
                    await createAgentArtifactFixture(path.join(project, "license/agent"), publicKey)
                    assert((await wizard(project, issuer)).includes("授权目录已就绪"))
                } else await runCommand(executable, args, cwd, { ...options, env: { ...options?.env, ...gitEnvironment } })
            })
            assert.equal(process.exitCode, previousExitCode)
        } finally {
            process.chdir(previousCwd)
            process.exitCode = previousExitCode

            for (const [index, stream] of [process.stdin, process.stdout].entries()) {
                if (descriptors[index]) Object.defineProperty(stream, "isTTY", descriptors[index])
                else delete stream.isTTY
            }
        }

        await assertScaffold(project, true)
        await validateNextJsLicense(project)
    })

    await t.test("incorrect product, signature, and deployment manifest are rejected", async () => {
        for (const scenario of ["product", "signature", "manifest"]) {
            const name = scenario === "product" ? "package.json" : scenario === "signature" ? "license/policy.jws" : "license/manifest.json"
            const file = path.join(project, name)
            const original = await fs.readFile(file)
            const value = JSON.parse(original)
            if (scenario === "product") value.name = "different-product"
            if (scenario === "signature") value.signature = Buffer.alloc(64).toString("base64url")
            if (scenario === "manifest") value.productMajorVersion += 1

            try {
                await fs.writeFile(file, JSON.stringify(value))
                await assert.rejects(validateNextJsLicense(project), /不匹配|验签/)
            } finally {
                await fs.writeFile(file, original)
            }
        }
    })

    await t.test("canceling a successful-exit wizard is not accepted as initialized", async () => {
        await assert.rejects(
            configureNextJsLicense(project, true, async () => {
                assert((await wizard(project, issuer, "n")).includes("已取消"))
            }),
            /缺少项目授权策略/,
        )
        assert.deepEqual(await fs.readdir(path.join(project, "license")), ["agent"])
    })

    await t.test("missing signing material stops license initialization", async () => {
        await assert.rejects(
            configureNextJsLicense(project, true, async () => {
                await wizard(project, path.join(root, "missing-issuer"))
            }),
            /无法读取统一签发公钥/,
        )
        assert.deepEqual(await fs.readdir(path.join(project, "license")), ["agent"])
    })
})
