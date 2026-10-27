import { startMockRelay } from "./mock-relay";

const port = Number(process.env.DEV_RELAY_PORT ?? 7777);
startMockRelay(port, { log: true }).then((r) => console.log(`開発用リレー起動: ${r.url}（メモリ保存・再起動で消えます）`));
