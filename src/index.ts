import { DurableObject } from "cloudflare:workers";
import { ViewCounterDurableObject } from "./ViewCounterDO";

// 导出 ViewCounterDurableObject 供 wrangler 使用
export { ViewCounterDurableObject };

export default {
	/**
   * 处理传入的 HTTP 请求。
   * @param {Request} request - 传入的 HTTP 请求。
   * @param {Object} env - Cloudflare Worker 的环境对象，包含绑定。
   * @param {Object} env.VIEW_COUNTER_DO - 绑定到 Durable Object 命名空间的实例。
   * 
   * 支持的接口：
   * 1. GET/POST /{path} - 获取或增加指定路径的访问量
   * 2. POST /batch - 批量获取多个路径的访问量，请求体格式：["/path1", "/path2"]
   * 
   * @returns {Response} - HTTP 响应。
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // 设置 CORS 头部，允许来自任何源的请求
    const headers = {
      "Access-Control-Allow-Origin": "*", // 允许所有来源，生产环境请根据需要限制
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 处理 OPTIONS 请求（CORS 预检请求）
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // 获取请求的 Host (域名)，这将作为 Durable Object ID 的一部分，实现多租户
    const requestHost = request.headers.get('Host');
    console.log(`Request Host: ${requestHost}`);
    if (!requestHost) {
      return new Response(JSON.stringify({ error: "Missing Host header" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // 批量获取接口
    if (url.pathname === "/batch") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { ...headers, "Allow": "POST, OPTIONS" } });
      }

      let articlePaths;
      try {
        // 从请求体中解析 JSON 数组，每个元素是一个路径字符串
        articlePaths = await request.json();
        if (!Array.isArray(articlePaths) || articlePaths.some(path => typeof path !== 'string' || path.trim() === '')) {
          throw new Error("Invalid request format. Expected an array of path strings, e.g., ['/path1', '/path2'].");
        }
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Invalid request body: ${e.message}` }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      const results: Record<string, number | null> = {};
      const promises = articlePaths.map(async (path) => {
        const articlePath = path.startsWith('/') ? path : `/${path}`; // 确保路径以 / 开头

        // 结合当前请求的 host 和 path 创建唯一的 Durable Object ID
        const doIdName = `${requestHost}${articlePath}`;
        const stub = env.VIEW_COUNTER_DO.get(env.VIEW_COUNTER_DO.idFromName(doIdName));

        try {
          // 向 Durable Object 发送 GET 请求以获取阅读量
          // 注意：Durable Object 内部的 URL 并不重要，因为我们只关心其 fetch 方法的调用
          const response = await stub.fetch(new Request("http://do-internal/get", { method: "GET" }));
          const data = await response.json() as { views: number };
          results[articlePath] = data.views; // 返回的键是路径本身
        } catch (error) {
          console.error(`Error fetching views for ${articlePath}:`, error);
          results[articlePath] = null; // 或者其他错误指示
        }
      });

      await Promise.all(promises);

      return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // 单个获取/增加接口
    // 移除查询参数 articleId，直接使用 URL 路径作为文章 ID
    const articlePath = url.pathname;

    // 确保路径不是根路径，并且不是 /batch 路径
    if (articlePath === "/" || articlePath === "/batch") {
      return new Response(JSON.stringify({ error: "Invalid article path. Please provide a specific article path (e.g., /article/1)." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // 结合请求的 Host 和 URL 路径创建唯一的 Durable Object ID
    const doIdName = `${requestHost}${articlePath}`;

    // 获取 Durable Object 实例的桩（stub），用于与之通信
    const id = env.VIEW_COUNTER_DO.idFromName(doIdName);
    const stub = env.VIEW_COUNTER_DO.get(id);

    // 将原始请求转发到 Durable Object
    // Durable Object 会处理 GET 或 POST 逻辑
    // 为了让 DO 内部的 fetch 方法能区分 GET/POST，我们可以传递原始请求的 method
    const response = await stub.fetch(new Request(url.toString(), { method: request.method }));

    // 返回 Durable Object 的响应，并添加 CORS 头部
    return new Response(response.body, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers.entries()), ...headers },
    });
  },
} satisfies ExportedHandler<Env>;
