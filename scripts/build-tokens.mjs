import StyleDictionary from "style-dictionary";

const dictionary = new StyleDictionary({
  source: ["tokens/**/*.json"],
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "dist/tokens/",
      files: [{ destination: "variables.css", format: "css/variables" }],
    },
    scss: {
      transformGroup: "scss",
      buildPath: "dist/tokens/",
      files: [{ destination: "_variables.scss", format: "scss/variables" }],
    },
    json: {
      buildPath: "dist/tokens/",
      files: [{ destination: "tokens.json", format: "json/flat" }],
    },
  },
});

await dictionary.buildAllPlatforms();
console.log("Style Dictionary token artifacts written to dist/tokens/");
