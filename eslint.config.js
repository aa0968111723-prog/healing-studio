export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".vite/**",
      "*.min.js",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: {
        parseForESLint() {
          return {
            ast: {
              type: "Program",
              body: [],
              comments: [],
              sourceType: "module",
              tokens: [],
              range: [0, 0],
              loc: {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 0 },
              },
            },
          };
        },
      },
    },
    rules: {},
  },
];
