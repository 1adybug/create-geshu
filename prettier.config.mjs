// @ts-check

/**
 * @type {import("@1adybug/prettier").Options}
 */
const config = {
    semi: false,
    tabWidth: 4,
    arrowParens: "avoid",
    endOfLine: "lf",
    printWidth: 160,
    plugins: ["@1adybug/prettier"],
    controlStatementBraces: "add",
    multiLineBraces: "add",
    nodeProtocol: "add",
}

export default config
