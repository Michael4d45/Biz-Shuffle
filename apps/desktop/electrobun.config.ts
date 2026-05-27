import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "BizShuffle",
    identifier: "dev.bizshuffle.desktop",
    version: "0.0.16",
    description: "BizShuffle desktop — Host, Join, and embedded admin",
  },
  scripts: {
    preBuild: "scripts/stage-admin-static.ts",
    postBuild: "scripts/embed-win-icons.ts",
    postWrap: "scripts/embed-win-icons.ts",
    postPackage: "scripts/embed-win-icons.ts",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      shell: {
        entrypoint: "src/views/shell/index.ts",
      },
    },
    copy: {
      "src/views/shell/index.html": "views/shell/index.html",
      "src/views/shell/index.css": "views/shell/index.css",
      ".static-bundle/priv/static": "priv/static",
      "../../assets/server.lua": "assets/server.lua",
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icons: "icon.iconset",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "icon.iconset/icon_256x256.png",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
      icon: "icon.iconset/icon_256x256.png",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  release: {
    baseUrl: "https://github.com/Michael4d45/Biz-Shuffle/releases/latest/download",
  },
} satisfies ElectrobunConfig;
