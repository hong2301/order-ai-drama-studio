// characters 字典档: 更新/删除(通用 CRUD 工厂)
import { crudItem } from "@/lib/server/http";

const h = crudItem("characters");
export const PUT = h.PUT;
export const DELETE = h.DELETE;
