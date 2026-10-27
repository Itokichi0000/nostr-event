import "dotenv/config";

// すべてのテストはテスト専用DBを使う（開発DBを汚さない）
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.GATHER_DISABLE_RATE_LIMIT = "1";
process.env.NOSTR_FALLBACK_RELAYS = "";
process.env.NOSTR_INDEX_RELAYS = "";
