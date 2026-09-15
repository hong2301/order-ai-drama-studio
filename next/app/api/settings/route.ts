// 全局配置: GET /api/settings -> { key: value }(目前记录数据存放路径)
import { getDb, queryAll } from "@/lib/server/db";

export async function GET(): Promise<Response> {
  const db = await getDb(); // 触发建表+记录 data_path
  const rows = queryAll(db, "SELECT key, value FROM settings");
  const list: Record<string, string> = {};
  for (const r of rows) list[r.key as string] = r.value as string;
  return Response.json(list);
}