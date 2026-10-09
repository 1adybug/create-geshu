import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import spawn from "cross-spawn"

import { detectPackageManager, getNextJsSetupCommands, getPrismaCommand } from "../package-manager.ts"

async function workspace(t, userAgent) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "create-geshu-manager "))
    const previousUserAgent = process.env.npm_config_user_agent

    if (userAgent === undefined) delete process.env.npm_config_user_agent
    else process.env.npm_config_user_agent = userAgent

    t.after(async () => {
        if (previousUserAgent === undefined) delete process.env.npm_config_user_agent
        else process.env.npm_config_user_agent = previousUserAgent

        assert.equal(path.dirname(directory), await fs.realpath(os.tmpdir()))
        assert(path.basename(directory).startsWith("create-geshu-manager "))
        await fs.rm(directory, { recursive: true, force: true })
    })

    return directory
}

for (const [userAgent, expected, executable, prefix] of [
    ["npm/11.12.1 node/v24.15.0", "npm", "npx", ["--yes"]],
    ["pnpm/11.10.0 npm/? node/v24.15.0", "pnpm", "pnpm", ["dlx", "--allow-build=@prisma/engines"]],
    ["pnpm/6.35.0 npm/? node/v18.0.0", "pnpm@6", "pnpm", ["dlx"]],
    ["bun/1.3.14 npm/? node/v24.3.0", "bun", "bun", ["x"]],
    ["yarn/4.9.2 npm/? node/v24.15.0", "yarn@berry", "yarn", ["dlx"]],
    ["yarn/1.22.22 npm/? node/v24.15.0", "yarn", "npx", ["--yes"]],
]) {
    test(`${expected}: launching manager overrides conflicting project metadata and pins Prisma`, async t => {
        const directory = await workspace(t, userAgent)
        await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ packageManager: "yarn@1.22.22" }))
        await fs.writeFile(path.join(directory, "pnpm-lock.yaml"), "")
        const manager = await detectPackageManager(directory)
        assert.equal(manager.agent, expected)
        const version = ">=7.10.0 <8"

        assert.deepEqual(getPrismaCommand(manager, version, ["migrate", "diff", "--from-empty"]), {
            command: executable,
            args:
                executable === "npx"
                    ? ["--yes", "--package", `prisma@${version}`, "prisma", "migrate", "diff", "--from-empty"]
                    : [...prefix, `prisma@${version}`, "migrate", "diff", "--from-empty"],
        })

        const instructions = getNextJsSetupCommands(manager).split("，")
        assert(instructions.every(command => command.startsWith(`${manager.name} `)))
        assert(instructions[1].endsWith("run db:dev"))
        assert(instructions[2].endsWith("run dev"))
    })
}

for (const version of ["7.33.7", "9.15.9", "10.1.0", "10.2.0", "10.32.0", "11.10.0"]) {
    test(`pnpm ${version}: approves Prisma engines only when --allow-build is supported`, () => {
        const { args } = getPrismaCommand({ name: "pnpm", agent: "pnpm", version }, "^7.10.0", ["migrate", "diff"])
        const allowsBuild = !["7.33.7", "9.15.9", "10.1.0"].includes(version)
        assert.deepEqual(args, ["dlx", ...(allowsBuild ? ["--allow-build=@prisma/engines"] : []), "prisma@^7.10.0", "migrate", "diff"])
    })
}

for (const [version, prefix] of [
    ["9.15.9", ["dlx"]],
    ["11.10.0", ["dlx", "--allow-build=@prisma/engines"]],
]) {
    test(`pnpm without version metadata: queries installed ${version} before choosing build approval flags`, async t => {
        const directory = await workspace(t)
        await fs.writeFile(path.join(directory, "pnpm-lock.yaml"), "")

        t.mock.method(spawn, "sync", (command, args, options) => {
            assert.equal(command, "pnpm")
            assert.deepEqual(args, ["--version"])
            assert.equal(options.timeout, 10_000)
            return { status: 0, stdout: `${version}\n` }
        })

        assert.deepEqual(getPrismaCommand(await detectPackageManager(directory), "^7.10.0", ["migrate", "diff"]), {
            command: "pnpm",
            args: [...prefix, "prisma@^7.10.0", "migrate", "diff"],
        })
    })
}

test("pnpm version detection failures stop before launching Prisma", t => {
    for (const result of [
        { status: 1, stdout: "11.10.0" },
        { status: 0, stdout: "invalid" },
        { status: null, stdout: "", error: new Error("pnpm not found") },
    ]) {
        const mock = t.mock.method(spawn, "sync", () => result)
        assert.throws(() => getPrismaCommand({ name: "pnpm", agent: "pnpm" }, "^7.10.0", ["migrate", "diff"]), /无法确认 pnpm 版本/)
        mock.mock.restore()
    }
})

test("without launcher metadata, explicit packageManager takes priority over lock files", async t => {
    const directory = await workspace(t)
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ packageManager: "yarn@4.9.2" }))
    await fs.writeFile(path.join(directory, "pnpm-lock.yaml"), "")
    assert.equal((await detectPackageManager(directory)).agent, "yarn@berry")
})

test("without launcher metadata, devEngines and lock files use the detector's strategies", async t => {
    const directory = await workspace(t)
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ devEngines: { packageManager: { name: "bun", version: "1.3.14" } } }))
    assert.equal((await detectPackageManager(directory)).agent, "bun")
    await fs.unlink(path.join(directory, "package.json"))
    await fs.writeFile(path.join(directory, "pnpm-lock.yaml"), "")
    assert.equal((await detectPackageManager(directory)).agent, "pnpm")
})

test("empty launch directory defaults to npm without inheriting a parent project", async t => {
    const directory = await workspace(t)
    await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ packageManager: "yarn@4.9.2" }))
    const child = path.join(directory, "launch-directory")
    await fs.mkdir(child)
    assert.deepEqual(await detectPackageManager(child), { name: "npm", agent: "npm" })
})

test("a recognized unsupported manager is not silently replaced by npm", async t => {
    const directory = await workspace(t, "deno/2.0.0")
    await assert.rejects(detectPackageManager(directory), /暂不支持 deno/)
})
