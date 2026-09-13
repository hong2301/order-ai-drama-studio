// API 路由通用帮助: 统一 JSON 响应/错误 + 字典档 CRUD handler 工厂
import type { NextRequest } from "next/server";
import { RESOURCES } from "./catalog";

export function jsonError(status: number, detail: string): Response {
  return Response.json({ detail }, { status });
}

/** 业务错误: 路由层 catch 后按 status 返回(避免把 400 逻辑错当 500) */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function serverError(e: unknown): Response {
  return jsonError(500, (e as Error).message || String(e));
}

/** 集合级 handler: GET 列表 / POST 创建 */
export function crudCollection(key: string) {
  const { repo, label } = RESOURCES[key];
  async function GET(): Promise<Response> {
    try { return Response.json(await repo.list()); } catch (e) { return serverError(e); }
  }
  async function POST(req: NextRequest): Promise<Response> {
    try {
      const payload = (await req.json()) as Record<string, unknown>;
      const id = await repo.create(payload);
      return Response.json({ id });
    } catch (e) {
      return jsonError(400, `${label}创建失败: ${(e as Error).message}`);
    }
  }
  return { GET, POST };
}

/** 单项 handler: PUT 更新 / DELETE 删除 */
export function crudItem(key: string) {
  const { repo } = RESOURCES[key];
  type Ctx = { params: Promise<{ id: string }> };
  async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
    try {
      const { id } = await ctx.params;
      const payload = (await req.json()) as Record<string, unknown>;
      if (!(await repo.update(Number(id), payload))) return jsonError(404, "记录不存在");
      return Response.json({ ok: true });
    } catch (e) { return serverError(e); }
  }
  async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
    try {
      const { id } = await ctx.params;
      if (!(await repo.remove(Number(id)))) return jsonError(404, "记录不存在");
      return Response.json({ ok: true });
    } catch (e) { return serverError(e); }
  }
  return { PUT, DELETE };
}