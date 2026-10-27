import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("以下を .env に追記してください:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
