import type {FastifyInstance} from "fastify";
import {addCategory,renameCategory} from "@agidawn/backend/admin/categories";
import {adminHandler} from "./admin-auth.ts";
export function registerCategories(app:FastifyInstance) {
  app.post("/api/admin/categories",adminHandler(async(req,_reply,admin)=>addCategory(req.body,admin.name)));
  app.patch("/api/admin/categories/:id",adminHandler(async(req,_reply,admin)=>renameCategory((req.params as {id:string}).id,req.body,admin.name)));
}
