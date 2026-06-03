// استيراد مباشر ومبسط عشان Railway ميتلخبطش
const logger = {
  info: (msg: any) => console.log(`[INFO] ${msg}`),
  error: (err: any, msg: string) => console.error(`[ERROR] ${msg}`, err),
  warn: (msg: any) => console.warn(`[WARN] ${msg}`)
};

import {
  Client,
  GatewayIntentBits,
  // باقي المكتبات اللي كنت بتستخدمها حطها هنا تحت الـ import ده
} from "discord.js";

// كمل بقية الكود بتاعك من هنا عادي...
// (لاحظ إني عرفت الـ logger جوه نفس الملف عشان متوجعش دماغك بملفات تانية)
