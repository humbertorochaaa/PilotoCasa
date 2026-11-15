import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedHosts = new Set([
  "nfce.fazenda.sp.gov.br",
  "www.nfce.fazenda.sp.gov.br",
  "homologacao.nfce.fazenda.sp.gov.br",
  "www.homologacao.nfce.fazenda.sp.gov.br",
]);

function defaultKey(variable: string, mapVariable: string): string {
  const direct = Deno.env.get(variable);
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get(mapVariable) || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

function isAllowedUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return url.protocol === "https:"
    && allowedHosts.has(url.hostname.toLowerCase())
    && !url.username
    && !url.password
    && !url.port
    && (
      path.includes("consultaqrcode")
      || path.endsWith("/consulta")
      || path.endsWith("/consulta/")
      || path.endsWith("/qrcode")
      || path.endsWith("/qrcode/")
      || path.endsWith("/nfceconsultapublica")
      || path.endsWith("/nfceconsultapublica/")
    );
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
      const number = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(number) && number <= 0x10ffff ? String.fromCodePoint(number) : " ";
    });
}

function htmlToLines(html: string): string[] {
  const plain = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(td|th|tr|div|p|li|h[1-6]|section|article|table|ul|ol|header|footer|label)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  );
  return plain.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function parseBrazilianNumber(value: string): number {
  const normalized = value.replace(/[^\d,.-]/g, "");
  if (!normalized) return 0;
  const parsed = normalized.includes(",")
    ? Number(normalized.replace(/\./g, "").replace(",", "."))
    : Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUnit(value: string): string {
  const unit = value.trim().toLowerCase().replace(/\./g, "");
  if (["kg", "quilo", "quilos"].includes(unit)) return "kg";
  if (["g", "gr", "grama", "gramas"].includes(unit)) return "g";
  if (["l", "lt", "litro", "litros"].includes(unit)) return "L";
  if (["ml", "mililitro", "mililitros"].includes(unit)) return "ml";
  return "un";
}

function cleanItemName(value: string): string {
  return value
    .replace(/\(?\s*c[oó]digo\s*:.*$/i, "")
    .replace(/^\s*(?:NOTA FISCAL|DOCUMENTO AUXILIAR|NFC-?E)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseReceipt(lines: string[], sourceUrl: URL) {
  const fullText = lines.join("\n");
  const quantityMatches = [...fullText.matchAll(/Qtde\.?\s*:\s*([\d.,]+)/gi)];
  const items = quantityMatches.flatMap((quantityMatch, index) => {
    const start = quantityMatch.index ?? 0;
    const end = index + 1 < quantityMatches.length
      ? quantityMatches[index + 1].index ?? fullText.length
      : fullText.length;
    const block = fullText.slice(start, end);
    const beforeLines = fullText.slice(Math.max(0, start - 700), start)
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
    const codeLine = beforeLines.find((line) => /c[oó]digo\s*:/i.test(line));
    const name = [codeLine, ...beforeLines]
      .filter(Boolean)
      .map((line) => cleanItemName(line || ""))
      .find((line) => line.length >= 3
        && /[A-Za-zÀ-ÿ]/.test(line)
        && !/^(?:un\s*:|qtde\.?\s*:|vl\.?\s*(?:unit|total)\b|valor\s+(?:total|a pagar)\b)/i.test(line)
        && !/\b(cnpj|cpf|avenida|rua|rodovia|emissão|emissao|data\/hora|protocolo|chave de acesso|documento auxiliar|nota fiscal)\b/i.test(line))
      || "";
    const quantity = parseBrazilianNumber(quantityMatch[1]);
    const unitMatch = block.match(/\bUN\s*:\s*([A-Za-z]{1,6})\b/i);
    const totalMatch = block.match(/(?:Vl\.?\s*Total|Vlr\.?\s*Total|Valor\s+Total)[\s\S]{0,40}?(?:R\$\s*)?([\d.]+(?:,\d{1,4})?)/i);
    const price = totalMatch ? parseBrazilianNumber(totalMatch[1]) : 0;
    if (!name || name.length < 3 || !/[A-Za-zÀ-ÿ]/.test(name) || !(quantity > 0) || !(price > 0)) return [];
    return [{
      name: name.slice(0, 90),
      quantity,
      unit: normalizeUnit(unitMatch?.[1] || ""),
      price: Math.round(price * 100) / 100,
    }];
  });

  const expectedMatch = fullText.match(/(?:Qtd\.?\s*total\s*de\s*itens|Quantidade\s*total\s*de\s*itens)\s*:?\s*(\d{1,3})/i);
  const expectedItemCount = expectedMatch ? Number(expectedMatch[1]) : 0;
  const payableMatch = fullText.match(/(?:Valor\s+a\s+pagar|Total\s+a\s+pagar)\s*(?:R\$\s*)?:?\s*([\d.]+,\d{2})/i)
    || fullText.match(/Valor\s+Total\s*(?:R\$\s*)?:?\s*([\d.]+,\d{2})/i);
  const receiptTotal = payableMatch ? parseBrazilianNumber(payableMatch[1]) : 0;
  const cnpjIndex = lines.findIndex((line) => /\bCNPJ\s*:/i.test(line));
  const cnpjLineStore = cnpjIndex >= 0 ? lines[cnpjIndex].split(/\bCNPJ\s*:/i)[0].trim() : "";
  const store = (cnpjLineStore || (cnpjIndex > 0 ? lines[cnpjIndex - 1] : ""))
    .replace(/\s+/g, " ").trim();
  const dateMatch = fullText.match(/(?:Emiss[aã]o|Data\/Hora)\s*:?\s*([0-3]?\d)[/.-]([01]?\d)[/.-](20\d{2})/i);
  const date = dateMatch
    ? dateMatch[3] + "-" + dateMatch[2].padStart(2, "0") + "-" + dateMatch[1].padStart(2, "0")
    : "";
  const accessKey = sourceUrl.searchParams.get("p")?.match(/\d{44}/)?.[0] || "";
  const itemSum = items.reduce((sum, item) => sum + item.price, 0);
  const countMatches = !expectedItemCount || expectedItemCount === items.length;
  if (!store) throw new Error("A consulta da SEFAZ abriu, mas não encontrei o nome do mercado.");
  if (!items.length) throw new Error("A consulta da SEFAZ abriu, mas não encontrei os itens. Confira se a nota está disponível na consulta pública.");
  if (expectedItemCount && !countMatches) {
    throw new Error(`A nota informa ${expectedItemCount} itens, mas consegui reconhecer ${items.length}. Não preenchi a lista para evitar dados incompletos.`);
  }
  if (!(receiptTotal > 0)) throw new Error("Encontrei os itens, mas não reconheci o total da nota.");
  const plausibleTotal = Math.abs(itemSum - receiptTotal) <= Math.max(10, receiptTotal * 0.15);
  if (!plausibleTotal) throw new Error("Os valores dos itens não conferem com o total da nota. Não preenchi para evitar valores incorretos.");
  return { store, date, items, expectedItemCount, total: receiptTotal, accessKey };
}

Deno.serve(async (request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = defaultKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  if (!authorization || !supabaseUrl || !anonKey) return json({ error: "Entre no piloto para importar a nota." }, 401);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sua sessão expirou. Entre novamente." }, 401);

  let body: { qrValue?: string };
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const value = String(body.qrValue || "").trim();
  if (!value || value.length > 4096) return json({ error: "QR code inválido." }, 400);

  let target: URL;
  try { target = new URL(value); } catch { return json({ error: "O QR precisa conter o link completo da consulta." }, 400); }
  if (!isAllowedUrl(target)) return json({ error: "A importação automática está habilitada para consultas NFC-e de São Paulo." }, 400);

  try {
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      response = await fetch(target.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (compatible; DespensaBeta/1.0; +https://humbertorochaaa.github.io/PilotoCasa/)",
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects === 3) return json({ error: "A consulta da SEFAZ redirecionou para um endereço não disponível." }, 502);
      const next = new URL(location, target);
      if (!isAllowedUrl(next)) return json({ error: "O endereço de consulta da nota não foi reconhecido como SEFAZ-SP." }, 400);
      target = next;
    }
    if (!response?.ok) return json({ error: "A SEFAZ não conseguiu abrir essa nota agora." }, 502);
    const html = await response.text();
    if (html.length > 3_000_000) return json({ error: "A página da consulta é grande demais para importar." }, 502);
    const lines = htmlToLines(html);
    const receipt = parseReceipt(lines, target);
    return json({ receipt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return json({ error: message || "Não foi possível consultar a nota na SEFAZ. Use uma foto nítida como alternativa." }, 422);
  }
});

