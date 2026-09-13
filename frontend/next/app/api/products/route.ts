// products 字典档: 列表/创建(通用 CRUD 工厂)
import { crudCollection } from "@/lib/server/http";

const h = crudCollection("products");
export const GET = h.GET;
export const POST = h.POST;
