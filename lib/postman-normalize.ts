import type {
  PostmanCollection,
  PostmanItemOrGroup,
  PostmanItemGroup,
  PostmanItem,
  PostmanRequest,
  PostmanRequestObject,
  PostmanUrl,
  PostmanDescription,
  PostmanHeader,
  PostmanBody,
  PostmanResponse,
  PostmanVariable,
} from "./postman-types";

// ---------- Normalized tree the renderer consumes ----------

export interface FolderNode {
  kind: "folder";
  id: string;
  name: string;
  description: string | null;
  children: TreeNode[];
}

export interface RequestNode {
  kind: "request";
  id: string;
  name: string;
  method: string;
  url: string;
  description: string | null;
  headers: NormalHeader[];
  queryParams: NormalParam[];
  pathVariables: NormalParam[];
  body: NormalBody | null;
  responses: NormalResponse[];
}

export type TreeNode = FolderNode | RequestNode;

export interface NormalHeader {
  key: string;
  value: string;
  description: string | null;
  disabled: boolean;
}

export interface NormalParam {
  key: string;
  value: string;
  description: string | null;
  disabled: boolean;
}

export interface NormalBody {
  mode: string;
  language: string; // for syntax hinting: json, xml, text, etc.
  content: string; // rendered text representation
  params?: NormalParam[]; // for urlencoded / formdata
}

export interface NormalResponse {
  id: string;
  name: string;
  code: number | null;
  status: string;
  body: string;
  language: string;
}

// ---------- Folder vs request detection ----------

function isFolder(node: PostmanItemOrGroup): node is PostmanItemGroup {
  return Array.isArray((node as PostmanItemGroup).item);
}

// ---------- Description normalization (string | object | null) ----------

export function normalizeDescription(
  desc: PostmanDescription | undefined
): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  if (typeof desc === "object" && typeof desc.content === "string") {
    return desc.content;
  }
  return null;
}

// ---------- Variable resolution ----------

export function buildVarMap(vars?: PostmanVariable[]): Record<string, string> {
  const map: Record<string, string> = {};
  if (!vars) return map;
  for (const v of vars) {
    if (v.disabled) continue;
    const key = v.key ?? v.id;
    if (key && v.value !== undefined && v.value !== null) {
      map[key] = String(v.value);
    }
  }
  return map;
}

export function resolveVars(
  input: string,
  varMap: Record<string, string>
): string {
  return input.replace(/\{\{([^}]+)\}\}/g, (match, name) => {
    const trimmed = String(name).trim();
    return varMap[trimmed] ?? match;
  });
}

// ---------- URL normalization (string | object) ----------

export function normalizeUrl(
  url: PostmanUrl | undefined,
  varMap: Record<string, string>
): string {
  if (!url) return "";
  if (typeof url === "string") return resolveVars(url, varMap);

  if (url.raw) return resolveVars(url.raw, varMap);

  // Reconstruct from parts if raw is missing
  const protocol = url.protocol ? `${url.protocol}://` : "";
  const host = Array.isArray(url.host)
    ? url.host.join(".")
    : url.host ?? "";
  const port = url.port ? `:${url.port}` : "";
  const path = Array.isArray(url.path)
    ? "/" +
      url.path
        .map((seg) => (typeof seg === "string" ? seg : seg.value ?? ""))
        .join("/")
    : url.path
    ? `/${url.path}`
    : "";

  return resolveVars(`${protocol}${host}${port}${path}`, varMap);
}

// ---------- Header normalization (array | string) ----------

function normalizeHeaders(
  header: PostmanHeader[] | string | undefined,
  varMap: Record<string, string>
): NormalHeader[] {
  if (!header) return [];
  if (typeof header === "string") {
    // Raw header string: split into lines "Key: Value"
    return header
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        const key = idx >= 0 ? line.slice(0, idx).trim() : line.trim();
        const value = idx >= 0 ? line.slice(idx + 1).trim() : "";
        return {
          key,
          value: resolveVars(value, varMap),
          description: null,
          disabled: false,
        };
      });
  }
  return header.map((h) => ({
    key: h.key,
    value: resolveVars(h.value ?? "", varMap),
    description: normalizeDescription(h.description),
    disabled: h.disabled ?? false,
  }));
}

// ---------- Query + path param normalization ----------

function normalizeQueryParams(
  url: PostmanUrl | undefined,
  varMap: Record<string, string>
): NormalParam[] {
  if (!url || typeof url === "string") return [];
  if (!url.query) return [];
  return url.query.map((q) => ({
    key: q.key ?? "",
    value: resolveVars(q.value ?? "", varMap),
    description: normalizeDescription(q.description),
    disabled: q.disabled ?? false,
  }));
}

function normalizePathVariables(
  url: PostmanUrl | undefined,
  varMap: Record<string, string>
): NormalParam[] {
  if (!url || typeof url === "string") return [];
  if (!url.variable) return [];
  return url.variable.map((v) => ({
    key: v.key ?? v.id ?? "",
    value: resolveVars(v.value ? String(v.value) : "", varMap),
    description: normalizeDescription(v.description),
    disabled: v.disabled ?? false,
  }));
}

// ---------- Body normalization ----------

function normalizeBody(
  body: PostmanBody | null | undefined,
  varMap: Record<string, string>
): NormalBody | null {
  if (!body || body.disabled) return null;

  const mode = body.mode ?? "raw";

  if (mode === "raw") {
    const lang = body.options?.raw?.language ?? "text";
    return {
      mode,
      language: lang,
      content: resolveVars(body.raw ?? "", varMap),
    };
  }

  if (mode === "urlencoded") {
    const params = (body.urlencoded ?? []).map((p) => ({
      key: p.key,
      value: resolveVars(p.value ?? "", varMap),
      description: normalizeDescription(p.description),
      disabled: p.disabled ?? false,
    }));
    return {
      mode,
      language: "text",
      content: params
        .filter((p) => !p.disabled)
        .map((p) => `${p.key}=${p.value}`)
        .join("&"),
      params,
    };
  }

  if (mode === "formdata") {
    const params = (body.formdata ?? []).map((p) => ({
      key: p.key,
      value:
        p.type === "file"
          ? `<file: ${Array.isArray(p.src) ? p.src.join(", ") : p.src ?? ""}>`
          : resolveVars(p.value ?? "", varMap),
      description: normalizeDescription(p.description),
      disabled: p.disabled ?? false,
    }));
    return {
      mode,
      language: "text",
      content: params
        .filter((p) => !p.disabled)
        .map((p) => `${p.key}: ${p.value}`)
        .join("\n"),
      params,
    };
  }

  if (mode === "graphql") {
    const q = body.graphql?.query ?? "";
    const v = body.graphql?.variables ?? "";
    return {
      mode,
      language: "graphql",
      content: v ? `${q}\n\n# Variables\n${v}` : q,
    };
  }

  if (mode === "file") {
    return {
      mode,
      language: "text",
      content: `<file: ${body.file?.src ?? "binary"}>`,
    };
  }

  return null;
}

// ---------- Response normalization ----------

function normalizeResponses(
  responses: PostmanResponse[] | undefined,
  idPrefix: string
): NormalResponse[] {
  if (!responses) return [];
  return responses.map((r, i) => {
    const body = r.body ?? "";
    // Try to detect JSON for language hint
    let language = "text";
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      language = "json";
    }
    return {
      id: `${idPrefix}-resp-${i}`,
      name: r.name ?? `Response ${i + 1}`,
      code: r.code ?? null,
      status: r.status ?? "",
      body: prettyIfJson(body),
      language,
    };
  });
}

function prettyIfJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

// ---------- Request method extraction ----------

function getMethod(request: PostmanRequest): string {
  if (typeof request === "string") return "GET";
  return (request.method ?? "GET").toUpperCase();
}

function getRequestObject(request: PostmanRequest): PostmanRequestObject {
  if (typeof request === "string") return { url: request, method: "GET" };
  return request;
}

// ---------- The main tree builder ----------

export function buildTree(collection: PostmanCollection): {
  rootName: string;
  rootDescription: string | null;
  nodes: TreeNode[];
  varMap: Record<string, string>;
} {
  const varMap = buildVarMap(collection.variable);

  function walk(
    items: PostmanItemOrGroup[],
    parentId: string
  ): TreeNode[] {
    return items.map((node, index) => {
      const id = `${parentId}-${index}`;

      if (isFolder(node)) {
        return {
          kind: "folder",
          id,
          name: node.name ?? "Untitled Folder",
          description: normalizeDescription(node.description),
          children: walk(node.item, id),
        } as FolderNode;
      }

      // It's a request item
      const item = node as PostmanItem;
      const reqObj = getRequestObject(item.request);

      return {
        kind: "request",
        id,
        name: item.name ?? "Untitled Request",
        method: getMethod(item.request),
        url: normalizeUrl(reqObj.url, varMap),
        description:
          normalizeDescription(item.description) ??
          normalizeDescription(reqObj.description),
        headers: normalizeHeaders(reqObj.header, varMap),
        queryParams: normalizeQueryParams(reqObj.url, varMap),
        pathVariables: normalizePathVariables(reqObj.url, varMap),
        body: normalizeBody(reqObj.body, varMap),
        responses: normalizeResponses(item.response, id),
      } as RequestNode;
    });
  }

  return {
    rootName: collection.info?.name ?? "API Documentation",
    rootDescription: normalizeDescription(collection.info?.description),
    nodes: walk(collection.item ?? [], "node"),
    varMap,
  };
}

// ---------- Find first request (for default selection) ----------

export function findFirstRequest(nodes: TreeNode[]): RequestNode | null {
  for (const node of nodes) {
    if (node.kind === "request") return node;
    const found = findFirstRequest(node.children);
    if (found) return found;
  }
  return null;
}

// Return the chain of nodes from root down to (and including) the node with `id`.
export function findPath(nodes: TreeNode[], id: string): TreeNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node];
    if (node.kind === "folder") {
      const sub = findPath(node.children, id);
      if (sub.length) return [node, ...sub];
    }
  }
  return [];
}

// Flatten the tree into visual/DFS order — used for keyboard up/down navigation.
// Includes both folders and requests, matching what the user sees in the sidebar.
export function flattenVisible(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.kind === "folder") {
      out.push(...flattenVisible(node.children));
    }
  }
  return out;
}

/** Requests only, DFS order — for Reference/Explorer keyboard nav. */
export function flattenRequests(nodes: TreeNode[]): RequestNode[] {
  const out: RequestNode[] = [];
  for (const node of nodes) {
    if (node.kind === "request") out.push(node);
    else out.push(...flattenRequests(node.children));
  }
  return out;
}

// Build stable, readable slugs for deep-linking to any node.
export function buildSlugMaps(nodes: TreeNode[]): {
  idToSlug: Record<string, string>;
  slugToId: Record<string, string>;
} {
  const idToSlug: Record<string, string> = {};
  const slugToId: Record<string, string> = {};
  const used = new Set<string>();

  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      const base = slugify(n.name) || n.kind;
      let slug = base;
      let i = 2;
      while (used.has(slug)) slug = `${base}-${i++}`;
      used.add(slug);
      idToSlug[n.id] = slug;
      slugToId[slug] = n.id;
      if (n.kind === "folder") walk(n.children);
    }
  };

  walk(nodes);
  return { idToSlug, slugToId };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- Guides (root + folder descriptions) ----------

export interface GuidePage {
  id: string;
  slug: string;
  title: string;
  markdown: string;
  depth: number;
}

/**
 * Build guide pages from the collection root description and every
 * folder that has a description. Nested folders keep their depth for TOC indent.
 */
export function extractGuides(
  rootName: string,
  rootDescription: string | null,
  nodes: TreeNode[]
): GuidePage[] {
  const guides: GuidePage[] = [];
  const used = new Set<string>();

  const uniqueSlug = (title: string, fallback: string) => {
    const base = slugify(title) || fallback;
    let slug = base;
    let i = 2;
    while (used.has(slug)) slug = `${base}-${i++}`;
    used.add(slug);
    return slug;
  };

  if (rootDescription?.trim()) {
    guides.push({
      id: "guide-root",
      slug: uniqueSlug(rootName, "overview"),
      title: rootName,
      markdown: rootDescription,
      depth: 0,
    });
  }

  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind !== "folder") continue;
      if (node.description?.trim()) {
        guides.push({
          id: `guide-${node.id}`,
          slug: uniqueSlug(node.name, "guide"),
          title: node.name,
          markdown: node.description,
          depth,
        });
      }
      walk(node.children, depth + 1);
    }
  };

  walk(nodes, rootDescription?.trim() ? 1 : 0);
  return guides;
}

// ---------- Code snippet generation ----------

export function toCurl(node: RequestNode): string {
  const lines: string[] = [`curl --location --request ${node.method} '${node.url}'`];
  for (const h of node.headers) {
    if (h.disabled) continue;
    lines.push(`--header '${h.key}: ${h.value}'`);
  }
  if (node.body) {
    if (node.body.mode === "raw" || node.body.mode === "graphql") {
      lines.push(`--data '${node.body.content}'`);
    } else if (node.body.mode === "urlencoded") {
      for (const p of node.body.params ?? []) {
        if (p.disabled) continue;
        lines.push(`--data-urlencode '${p.key}=${p.value}'`);
      }
    } else if (node.body.mode === "formdata") {
      for (const p of node.body.params ?? []) {
        if (p.disabled) continue;
        lines.push(`--form '${p.key}=${p.value}'`);
      }
    }
  }
  return lines.join(" \\\n  ");
}

export function toFetch(node: RequestNode): string {
  const headers: Record<string, string> = {};
  for (const h of node.headers) {
    if (!h.disabled) headers[h.key] = h.value;
  }

  const options: Record<string, unknown> = {
    method: node.method,
  };
  if (Object.keys(headers).length) options.headers = headers;
  if (node.body && (node.body.mode === "raw" || node.body.mode === "graphql")) {
    options.body = node.body.content;
  }

  return `fetch('${node.url}', ${JSON.stringify(options, null, 2)})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error(error));`;
}

// ---------- Multi-language snippet generation ----------

export interface CodeLanguage {
  key: string;
  label: string;
  syntax: string; // for future syntax highlighting hints
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { key: "curl", label: "cURL", syntax: "bash" },
  { key: "javascript", label: "JavaScript", syntax: "javascript" },
  { key: "python", label: "Python", syntax: "python" },
  { key: "go", label: "Go", syntax: "go" },
  { key: "php", label: "PHP", syntax: "php" },
  { key: "java", label: "Java", syntax: "java" },
  { key: "csharp", label: "C#", syntax: "csharp" },
  { key: "ruby", label: "Ruby", syntax: "ruby" },
];

// Return the active (non-disabled) headers as simple key/value pairs.
function activeHeaders(node: RequestNode): Array<{ key: string; value: string }> {
  return node.headers
    .filter((h) => !h.disabled)
    .map((h) => ({ key: h.key, value: h.value }));
}

// Return a body string if the request has a raw/graphql body, else null.
function rawBody(node: RequestNode): string | null {
  if (!node.body) return null;
  if (node.body.mode === "raw" || node.body.mode === "graphql") {
    return node.body.content;
  }
  return null;
}

function escapeSingle(str: string): string {
  return str.replace(/'/g, "\\'");
}

function escapeDouble(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toPython(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = ["import requests", ""];

  lines.push(`url = "${node.url}"`);

  if (headers.length) {
    lines.push("headers = {");
    headers.forEach((h, i) => {
      const comma = i < headers.length - 1 ? "," : "";
      lines.push(`    "${escapeDouble(h.key)}": "${escapeDouble(h.value)}"${comma}`);
    });
    lines.push("}");
  } else {
    lines.push("headers = {}");
  }

  if (body) {
    lines.push(`payload = """${body}"""`);
    lines.push("");
    lines.push(
      `response = requests.request("${node.method}", url, headers=headers, data=payload)`
    );
  } else {
    lines.push("");
    lines.push(`response = requests.request("${node.method}", url, headers=headers)`);
  }

  lines.push("");
  lines.push("print(response.text)");
  return lines.join("\n");
}

export function toGo(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"net/http"',
    '\t"io/ioutil"',
  ];
  if (body) lines.push('\t"strings"');
  lines.push(")", "", "func main() {");
  lines.push(`\turl := "${node.url}"`);

  if (body) {
    lines.push("\tmethod := \"" + node.method + "\"");
    lines.push(`\tpayload := strings.NewReader(\`${body}\`)`);
    lines.push("");
    lines.push("\tclient := &http.Client{}");
    lines.push("\treq, err := http.NewRequest(method, url, payload)");
  } else {
    lines.push("\tmethod := \"" + node.method + "\"");
    lines.push("");
    lines.push("\tclient := &http.Client{}");
    lines.push("\treq, err := http.NewRequest(method, url, nil)");
  }

  lines.push("\tif err != nil {");
  lines.push("\t\tfmt.Println(err)");
  lines.push("\t\treturn");
  lines.push("\t}");

  for (const h of headers) {
    lines.push(`\treq.Header.Add("${escapeDouble(h.key)}", "${escapeDouble(h.value)}")`);
  }

  lines.push("");
  lines.push("\tres, err := client.Do(req)");
  lines.push("\tif err != nil {");
  lines.push("\t\tfmt.Println(err)");
  lines.push("\t\treturn");
  lines.push("\t}");
  lines.push("\tdefer res.Body.Close()");
  lines.push("");
  lines.push("\tbody, _ := ioutil.ReadAll(res.Body)");
  lines.push("\tfmt.Println(string(body))");
  lines.push("}");
  return lines.join("\n");
}

export function toPhp(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = ["<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, array("];
  lines.push(`  CURLOPT_URL => '${escapeSingle(node.url)}',`);
  lines.push("  CURLOPT_RETURNTRANSFER => true,");
  lines.push(`  CURLOPT_CUSTOMREQUEST => '${node.method}',`);

  if (body) {
    lines.push(`  CURLOPT_POSTFIELDS => '${escapeSingle(body)}',`);
  }

  if (headers.length) {
    lines.push("  CURLOPT_HTTPHEADER => array(");
    headers.forEach((h) => {
      lines.push(`    '${escapeSingle(h.key)}: ${escapeSingle(h.value)}',`);
    });
    lines.push("  ),");
  }

  lines.push("));");
  lines.push("");
  lines.push("$response = curl_exec($curl);");
  lines.push("curl_close($curl);");
  lines.push("echo $response;");
  return lines.join("\n");
}

export function toJava(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = [
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "import java.net.URI;",
    "",
    "HttpClient client = HttpClient.newHttpClient();",
    "",
    "HttpRequest request = HttpRequest.newBuilder()",
    `    .uri(URI.create("${escapeDouble(node.url)}"))`,
  ];

  for (const h of headers) {
    lines.push(`    .header("${escapeDouble(h.key)}", "${escapeDouble(h.value)}")`);
  }

  if (body) {
    lines.push(
      `    .method("${node.method}", HttpRequest.BodyPublishers.ofString("${escapeDouble(
        body
      )}"))`
    );
  } else {
    lines.push(`    .method("${node.method}", HttpRequest.BodyPublishers.noBody())`);
  }

  lines.push("    .build();");
  lines.push("");
  lines.push(
    "HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());"
  );
  lines.push("System.out.println(response.body());");
  return lines.join("\n");
}

export function toCSharp(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = [
    "using System.Net.Http;",
    "",
    "var client = new HttpClient();",
    `var request = new HttpRequestMessage(new HttpMethod("${node.method}"), "${escapeDouble(
      node.url
    )}");`,
  ];

  for (const h of headers) {
    lines.push(`request.Headers.Add("${escapeDouble(h.key)}", "${escapeDouble(h.value)}");`);
  }

  if (body) {
    lines.push(`request.Content = new StringContent("${escapeDouble(body)}");`);
  }

  lines.push("");
  lines.push("var response = await client.SendAsync(request);");
  lines.push("response.EnsureSuccessStatusCode();");
  lines.push("Console.WriteLine(await response.Content.ReadAsStringAsync());");
  return lines.join("\n");
}

export function toRuby(node: RequestNode): string {
  const headers = activeHeaders(node);
  const body = rawBody(node);
  const lines: string[] = [
    'require "uri"',
    'require "net/http"',
    "",
    `url = URI("${node.url}")`,
    "",
    "https = Net::HTTP.new(url.host, url.port)",
    "https.use_ssl = true if url.scheme == \"https\"",
    "",
  ];

  const reqClass =
    node.method.charAt(0) + node.method.slice(1).toLowerCase();
  lines.push(`request = Net::HTTP::${reqClass}.new(url)`);

  for (const h of headers) {
    lines.push(`request["${escapeDouble(h.key)}"] = "${escapeDouble(h.value)}"`);
  }

  if (body) {
    lines.push(`request.body = ${JSON.stringify(body)}`);
  }

  lines.push("");
  lines.push("response = https.request(request)");
  lines.push("puts response.read_body");
  return lines.join("\n");
}

// Dispatch: given a language key, produce the snippet.
export function generateSnippet(node: RequestNode, langKey: string): string {
  switch (langKey) {
    case "curl":
      return toCurl(node);
    case "javascript":
      return toFetch(node);
    case "python":
      return toPython(node);
    case "go":
      return toGo(node);
    case "php":
      return toPhp(node);
    case "java":
      return toJava(node);
    case "csharp":
      return toCSharp(node);
    case "ruby":
      return toRuby(node);
    default:
      return toCurl(node);
  }
}