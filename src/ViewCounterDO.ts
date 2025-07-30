import { DurableObject } from "cloudflare:workers";

// src/ViewCounterDO.ts

/**
 * ViewCounterDurableObject 类用于存储和管理单个文章的阅读量。
 * 每个文章都将有一个独立的 Durable Object 实例。
 */
export class ViewCounterDurableObject extends DurableObject {
    views: number;

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.views = 0;
    }

    /**
     * 处理传入的请求。
     * 支持两种操作：
     * 1. GET 请求：返回当前阅读量。
     * 2. POST 请求：增加阅读量并返回新的阅读量。
     * @param {Request} request - 传入的 HTTP 请求
     * @returns {Response} - HTTP 响应
     */
    async fetch(request: Request): Promise<Response> {
        const headers = {
            "Content-Type": "application/json",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers });
        }

        // 确保每次都从存储读取最新值
        this.views = (await this.ctx.storage.get<number>("views")) ?? 0;

        if (request.method === "POST") {
            this.views++;
            await this.ctx.storage.put("views", this.views);
            return new Response(JSON.stringify({ views: this.views }), { headers });
        } else if (request.method === "GET") {
            return new Response(JSON.stringify({ views: this.views }), { headers });
        }

        return new Response("Method Not Allowed", { status: 405, headers });
    }
}
