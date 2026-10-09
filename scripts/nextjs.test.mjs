import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { runCommand } from "../commands.ts"
import { main, parseCliOptions } from "../index.ts"
import { configureNextJsLicense, getPrismaVersion, initializeNextJsPrismaMigration } from "../nextjs.ts"

const npm = { name: "npm", agent: "npm" }

async function workspace(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-test "))

    t.after(async () => {
        assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()))
        assert(path.basename(directory).startsWith("create-geshu-test "))
        await fs.rm(directory, { recursive: true, force: true })
    })

    return directory
}

async function template(directory) {
    await fs.mkdir(path.join(directory, "prisma"), { recursive: true })
    await fs.mkdir(path.join(directory, "license/agent"), { recursive: true })
    await fs.mkdir(path.join(directory, "scripts"), { recursive: true })
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "template", version: "1.0.0", devDependencies: { prisma: "^7.10.0" } }))
    await fs.writeFile(path.join(directory, "prisma/schema.prisma"), 'datasource db { provider = "sqlite" }')
    await fs.writeFile(path.join(directory, "prisma.config.ts"), "export default {}")
    await fs.writeFile(path.join(directory, ".gitignore"), "node_modules\r\n/prisma/migrations/\r\n*.db\r\n")
    await fs.writeFile(path.join(directory, "license/policy.jws"), "template policy")
    await fs.writeFile(path.join(directory, "license/agent/manifest.json"), "{}")
    await fs.writeFile(path.join(directory, "scripts/packageDeployment.mjs"), "")
    await fs.writeFile(path.join(directory, "SHADCN_TAILWIND_V4_MIGRATION.md"), "template documentation")
}

test("Prisma follows the template declaration and refuses unversioned packages", () => {
    assert.equal(getPrismaVersion({ devDependencies: { prisma: "^7.10.0" } }), "^7.10.0")
    assert.equal(getPrismaVersion({ dependencies: { prisma: "~7.10.0" } }), "~7.10.0")
    assert.equal(getPrismaVersion({ devDependencies: { prisma: ">=7.10.0 <8" } }), ">=7.10.0 <8")
    for (const version of [undefined, "latest", "*", "", "file:../prisma", "7.10.0 & echo bad"])
        assert.throws(() => getPrismaVersion({ devDependencies: { prisma: version } }), /Prisma 版本范围/)
})

test("license flags preserve the unset default and reject contradictory choices", () => {
    assert.equal(parseCliOptions([]).localLicense, undefined)
    assert.equal(parseCliOptions(["--local-license"]).localLicense, true)
    assert.equal(parseCliOptions(["--no-local-license"]).localLicense, false)
    assert.throws(() => parseCliOptions(["--local-license", "--no-local-license"]), /不能同时使用/)
})

test("migration generation uses the declared version and produces a complete migration without a database", async t => {
    const directory = await workspace(t)
    await template(directory)
    await initializeNextJsPrismaMigration(directory, npm, async (command, args, cwd, options) => {
        assert.equal(command, "npx")
        assert(args.includes("prisma@^7.10.0"))
        assert.deepEqual(args.slice(args.indexOf("migrate"), args.indexOf("--output")), [
            "migrate",
            "diff",
            "--config",
            "prisma.config.ts",
            "--from-empty",
            "--to-schema",
            "prisma/schema.prisma",
            "--script",
        ])
        assert.equal(cwd, directory)
        assert.equal(options.env.NODE_ENV, "development")
        await fs.writeFile(args[args.indexOf("--output") + 1], 'CREATE TABLE "user" (id TEXT PRIMARY KEY);\n')
    })
    assert.equal(await fs.readFile(path.join(directory, "prisma/migrations/migration_lock.toml"), "utf8"), 'provider = "sqlite"\n')
    assert.equal(await fs.stat(path.join(directory, "node_modules")).catch(() => null), null)
    assert.equal(await fs.stat(path.join(directory, "data")).catch(() => null), null)
})

for (const scenario of ["network failure", "missing SQL", "empty SQL", "comment-only SQL"]) {
    test(`migration generation rejects ${scenario} and removes incomplete migration files`, async t => {
        const directory = await workspace(t)
        await template(directory)
        await assert.rejects(
            initializeNextJsPrismaMigration(directory, npm, async (_command, args) => {
                if (scenario === "network failure") throw new Error("registry unavailable")
                if (scenario !== "missing SQL")
                    await fs.writeFile(args[args.indexOf("--output") + 1], scenario === "empty SQL" ? "\n" : "-- empty migration\n/* no statements */")
            }),
            /registry unavailable|迁移 SQL/,
        )
        assert.equal(await fs.stat(path.join(directory, "prisma/migrations")).catch(() => null), null)
    })
}

test("a native manager failure stops initialization without falling back to npx", async t => {
    const directory = await workspace(t)
    await template(directory)

    const calls = []

    await assert.rejects(
        initializeNextJsPrismaMigration(directory, { name: "pnpm", agent: "pnpm", version: "11.10.0" }, async command => {
            calls.push(command)
            throw new Error("pnpm registry unavailable")
        }),
        /pnpm registry unavailable/,
    )
    assert.deepEqual(calls, ["pnpm"])
    assert.equal(await fs.stat(path.join(directory, "prisma/migrations")).catch(() => null), null)
})

test("Yarn Classic announces its npx compatibility command before execution", async t => {
    const directory = await workspace(t)
    await template(directory)

    const messages = []

    t.mock.method(console, "log", message => messages.push(message))
    await initializeNextJsPrismaMigration(directory, { name: "yarn", agent: "yarn" }, async (command, args) => {
        assert.equal(command, "npx")
        assert(messages.some(message => message.includes("Yarn 1") && message.includes("npx")))
        await fs.writeFile(args[args.indexOf("--output") + 1], "CREATE TABLE example (id TEXT);")
    })
})

test("Yarn Berry adjusts only the temporary Prisma environment for PnP compatibility", async t => {
    const directory = await workspace(t)
    await template(directory)
    const config = "nodeLinker: pnp\n"
    await fs.writeFile(path.join(directory, ".yarnrc.yml"), config)
    await initializeNextJsPrismaMigration(directory, { name: "yarn", agent: "yarn@berry" }, async (command, args, _cwd, options) => {
        assert.equal(command, "yarn")
        assert.equal(options.env.YARN_NODE_LINKER, "node-modules")
        await fs.writeFile(args[args.indexOf("--output") + 1], "CREATE TABLE example (id TEXT);")
    })
    assert.equal(await fs.readFile(path.join(directory, ".yarnrc.yml"), "utf8"), config)
})

test("existing migrations are preserved", async t => {
    const directory = await workspace(t)
    await template(directory)
    await fs.mkdir(path.join(directory, "prisma/migrations"))
    await fs.writeFile(path.join(directory, "prisma/migrations/existing.sql"), "keep")
    await assert.rejects(
        initializeNextJsPrismaMigration(directory, npm, async () => assert.fail("must not run Prisma")),
        /已包含迁移/,
    )
    assert.equal(await fs.readFile(path.join(directory, "prisma/migrations/existing.sql"), "utf8"), "keep")
})

test("disabled licensing removes the deployment directory and preserves application code", async t => {
    const directory = await workspace(t)
    await template(directory)
    assert.equal(await configureNextJsLicense(directory, false), true)
    assert.equal(await fs.stat(path.join(directory, "license")).catch(() => null), null)
    assert.equal((await fs.stat(path.join(directory, "scripts/packageDeployment.mjs"))).isFile(), true)
    assert.equal(await configureNextJsLicense(directory, false), false)
})

test("license initialization clears template materials, preserves the agent, and propagates wizard failure", async t => {
    const directory = await workspace(t)
    await template(directory)
    await assert.rejects(
        configureNextJsLicense(directory, true, async (command, args, cwd) => {
            assert.equal(command, process.execPath)
            assert.equal(cwd, directory)
            assert.deepEqual(args, [path.join(directory, "scripts/packageDeployment.mjs"), "license"])
            assert.deepEqual(await fs.readdir(path.join(directory, "license")), ["agent"])
            throw new Error("missing signing materials")
        }),
        /missing signing materials/,
    )
})

for (const scenario of ["success", "network failure", "empty SQL"]) {
    test(`project creation ${scenario} respects the initialization commit boundary`, async t => {
        const directory = await workspace(t)
        const previousCwd = process.cwd()
        const previousExitCode = process.exitCode

        const log = []

        t.mock.method(console, "log", (...args) => log.push(args.join(" ")))
        t.mock.method(console, "error", (...args) => log.push(args.join(" ")))

        const calls = []

        process.chdir(directory)

        try {
            await main(["--type", "nextjs-shadcn", "--name", "example"], async (command, args, cwd) => {
                calls.push({ command, args, cwd })
                if (command === "git" && args[0] === "clone") await template(path.join(directory, "example"))

                if (args.includes("migrate")) {
                    if (scenario === "network failure") throw new Error("registry unavailable")
                    await fs.writeFile(args[args.indexOf("--output") + 1], scenario === "empty SQL" ? "" : "CREATE TABLE example (id TEXT);")
                }
            })

            if (scenario === "success") {
                const stage = calls.find(call => call.args[0] === "add")
                assert.deepEqual(stage.args.slice(0, 3), ["add", "-A", "--"])
                for (const file of ["package.json", ".gitignore", "prisma/migrations", "license", "SHADCN_TAILWIND_V4_MIGRATION.md"])
                    assert(stage.args.includes(file))
                assert(calls.some(call => call.args[0] === "commit"))
                assert(log.some(line => line.includes("创建完成")))
                assert(log.some(line => line.includes("本地授权: 关闭")))
                assert.equal(await fs.readFile(path.join(directory, "example/.gitignore"), "utf8"), "node_modules\r\n*.db\r\n")
            } else {
                assert.equal(process.exitCode, 1)
                assert(!calls.some(call => ["add", "commit"].includes(call.args[0])))
                assert(!log.some(line => line.includes("创建完成")))
                assert(log.some(line => line.includes("生成项目初始迁移")))
                assert((await fs.stat(path.join(directory, "example"))).isDirectory())
            }
        } finally {
            process.chdir(previousCwd)
            process.exitCode = previousExitCode
        }
    })
}

test("noninteractive license enablement fails before cloning", async t => {
    const previousExitCode = process.exitCode
    t.mock.method(console, "error", () => {})

    try {
        await main(["--type", "nextjs", "--name", "example", "--local-license"], async () => assert.fail("must not clone"))
        assert.equal(process.exitCode, 1)
    } finally {
        process.exitCode = previousExitCode
    }
})

test("non-Next templates do not invoke Prisma or alter licensing", async t => {
    const directory = await workspace(t)
    const previousCwd = process.cwd()
    const previousExitCode = process.exitCode
    t.mock.method(console, "log", () => {})
    process.chdir(directory)

    try {
        await main(["--type", "rsbuild", "--name", "example"], async (command, args) => {
            assert.equal(command, "git")
            if (args[0] === "clone") await template(path.join(directory, "example"))
        })
        assert.equal(await fs.readFile(path.join(directory, "example/license/policy.jws"), "utf8"), "template policy")
        assert.equal(await fs.stat(path.join(directory, "example/prisma/migrations")).catch(() => null), null)
    } finally {
        process.chdir(previousCwd)
        process.exitCode = previousExitCode
    }
})

test("command execution preserves paths with spaces and reports process failures", async t => {
    const directory = await workspace(t)
    const output = path.join(directory, "received arguments.json")
    const script = path.join(directory, "capture arguments.mjs")
    await fs.writeFile(script, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));')
    await runCommand(process.execPath, [script, output, "a path with spaces", ">=7.10.0 <8"], directory)
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), ["a path with spaces", ">=7.10.0 <8"])
    await assert.rejects(runCommand(process.execPath, ["-e", "process.exit(3)"], directory), /退出码 3/)
})

test("canceling a command rejects initialization and releases signal handlers", { timeout: 10_000 }, async t => {
    const directory = await workspace(t)
    const script = path.join(directory, "wait.mjs")
    const ready = path.join(directory, "ready")
    await fs.writeFile(script, 'import {writeFileSync} from "node:fs"; writeFileSync(process.argv[2], "ready"); setTimeout(() => {}, 60000);')
    const initialListeners = process.listenerCount("SIGINT")
    const running = runCommand(process.execPath, [script, ready], directory)
    const rejected = assert.rejects(running, /命令已取消/)

    try {
        while (!(await fs.stat(ready).catch(() => null))) await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
        process.emit("SIGINT")
    }

    await rejected
    assert.equal(process.listenerCount("SIGINT"), initialListeners)
})

test("Next names must also be valid product IDs before cloning", async t => {
    const previousExitCode = process.exitCode

    const errors = []

    t.mock.method(console, "error", message => errors.push(message))

    try {
        await main(["--type", "nextjs", "--name", "~example"], async () => assert.fail("must not clone"))
        assert.equal(process.exitCode, 1)
        assert(errors.some(message => message.includes("产品 ID")))
    } finally {
        process.exitCode = previousExitCode
    }
})
