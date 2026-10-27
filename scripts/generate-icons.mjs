// public/icons/icon.svg から PWA 用 PNG を生成（開発時に1回だけ実行。生成物はコミット済み）
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const out = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
  ["badge-96.png", 96, 0],
  ["icon-maskable-512.png", 512, 0.12],
];
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:${pad ? "#0f6e6e" : "transparent"};display:grid;place-items:center;width:${size}px;height:${size}px">
     <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: !pad });
}
await browser.close();
console.log("icons generated");
