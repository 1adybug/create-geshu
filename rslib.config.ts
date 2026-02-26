import { defineConfig } from "@rslib/core"

export default defineConfig({
    lib: [
        {
            format: "esm",
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
