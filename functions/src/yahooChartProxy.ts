import { onRequest } from "firebase-functions/v2/https";

const region = "asia-east1";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "massage-reserve-tsmc-pricing/1";

/** 僅代理 2330.TW 日 K，供後台顯示收盤價（Yahoo 不允許瀏覽器直連） */
export const yahooChartProxy = onRequest({ region, cors: true, invoker: "public" }, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawPath = req.path.replace(/^\/api\/yahoo-chart\/?/, "").replace(/^\//, "");
  const symbol = rawPath.split("/")[0]?.split("?")[0] ?? "";
  if (symbol !== "2330.TW") {
    res.status(400).send("symbol not allowed");
    return;
  }

  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstreamRes = await fetch(upstream, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    const body = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(body);
  } catch {
    res.status(502).send("upstream fetch failed");
  } finally {
    clearTimeout(timer);
  }
});
