import { defineConfig } from "@rslib/core"

export default defineConfig({
    lib: [
        {
            format: "esm",
            // CLI 随包携带运行依赖，避免 Yarn PnP 在加载外部 CJS 模块时失败。
            autoExternal: { dependencies: false },
            source: {
                entry: {
                    index: "./index.ts",
                },
            },
            output: {
                target: "node",
                distPath: {
                    root: "./dist",
                },
                cleanDistPath: true,
            },
            syntax: "es2022",
            dts: false,
            autoExtension: false,
        },
    ],
})
