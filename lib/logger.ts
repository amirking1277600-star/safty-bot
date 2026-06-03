export const logger = {
  info: (msg: any) => console.log(`[INFO] ${msg}`),
  error: (err: any, msg: string) => console.error(`[ERROR] ${msg}`, err),
  warn: (msg: any) => console.warn(`[WARN] ${msg}`)
};