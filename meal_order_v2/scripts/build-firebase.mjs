import { build } from "esbuild";
await build({
  entryPoints: ["scripts/firebase-sdk-entry.js"],
  outfile: "js/vendor/firebase-sdk.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["safari15", "chrome100", "edge100"],
  minify: true,
  legalComments: "eof",
});
