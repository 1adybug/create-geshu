import assert from "node:assert/strict"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

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
    ["pnpm/11.10.0 npm/? node/v24.15.0", "pnpm", "pnpm", ["dlx"]],
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
