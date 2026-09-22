import type {
  PostmanCollection,
  PostmanItemOrGroup,
  PostmanItemGroup,
} from "@/lib/postman-types";
import { slugify, buildTree, flattenRequests } from "@/lib/postman-normalize";
import type { OpenApiDiffSummary, DiffChange } from "@/lib/openapi-diff";

/** Max nesting depth for allowlist paths (collection → L1 → L2 → L3). */
export const MAX_FOLDER_DEPTH = 3;

export type FolderAllowlist = "all" | string[];

function isFolder(node: PostmanItemOrGroup): node is PostmanItemGroup {
  return Array.isArray((node as PostmanItemGroup).item);
}

function folderName(node: PostmanItemGroup): string {
  return (node.name ?? "Untitled Folder").trim() || "Untitled Folder";
}

function folderSlug(node: PostmanItemGroup): string {
  return slugify(folderName(node));
}

export interface FolderTreeNode {
  slug: string;
  name: string;
  /** Slash-separated path of slugs, e.g. "a/c/h" */
  path: string;
  children: FolderTreeNode[];
}

/** @deprecated Use listFolderTree — kept for any callers expecting flat L1 only. */
export interface TopLevelFolderOption {
  slug: string;
  name: string;
}

export function listTopLevelFolders(
  collection: PostmanCollection | null | undefined
): TopLevelFolderOption[] {
  return listFolderTree(collection).map(({ slug, name }) => ({ slug, name }));
}

/**
 * Nested folder tree up to MAX_FOLDER_DEPTH.
 * `path` values are what belong in folder_allowlist.
 */
export function listFolderTree(
  collection: PostmanCollection | null | undefined,
  maxDepth = MAX_FOLDER_DEPTH
): FolderTreeNode[] {
  if (!collection?.item?.length) return [];
  return walkFolderOptions(collection.item, "", 1, maxDepth);
}

function walkFolderOptions(
  items: PostmanItemOrGroup[],
  parentPath: string,
  depth: number,
  maxDepth: number
): FolderTreeNode[] {
  if (depth > maxDepth) return [];

  const seen = new Set<string>();
  const out: FolderTreeNode[] = [];

  for (const node of items) {
    if (!isFolder(node)) continue;
    const name = folderName(node);
    const slug = slugify(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const path = parentPath ? `${parentPath}/${slug}` : slug;
    const children =
      depth < maxDepth
        ? walkFolderOptions(node.item ?? [], path, depth + 1, maxDepth)
        : [];

    out.push({ slug, name, path, children });
  }

  return out;
}

interface AllowlistRules {
  /** Exact folder paths granted with full subtree */
  subtrees: Set<string>;
  /** Parent path → all direct child folders granted with full subtree */
  allChildren: Set<string>;
}

function buildRules(paths: string[]): AllowlistRules {
  const subtrees = new Set<string>();
  const allChildren = new Set<string>();

  for (const raw of paths) {
    const parts = raw.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    if (parts[parts.length - 1] === "all") {
      const parent = parts.slice(0, -1).join("/");
      if (parent) allChildren.add(parent);
      continue;
    }
    subtrees.add(parts.join("/"));
  }

  return { subtrees, allChildren };
}

function isFullyGranted(path: string, rules: AllowlistRules): boolean {
  const parts = path.split("/").filter(Boolean);

  // Any prefix is an explicit subtree grant
  for (let i = 1; i <= parts.length; i++) {
    if (rules.subtrees.has(parts.slice(0, i).join("/"))) return true;
  }

  // allChildren(parent) fully grants every child under parent (and their descendants)
  for (let i = 1; i <= parts.length; i++) {
    const parent = parts.slice(0, i - 1).join("/");
    if (parent && rules.allChildren.has(parent)) return true;
  }

  return false;
}

function needsPartial(path: string, rules: AllowlistRules): boolean {
  const prefix = `${path}/`;
  for (const s of rules.subtrees) {
    if (s.startsWith(prefix)) return true;
  }
  for (const p of rules.allChildren) {
    if (p === path || p.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Parse DB JSONB folder_allowlist.
 * [] or ["all"] → all folders.
 * Otherwise → path strings (e.g. "onboarding", "a/c/h", "a/c/all").
 */
export function parseFolderAllowlist(raw: unknown): FolderAllowlist {
  if (raw == null) return "all";
  if (!Array.isArray(raw)) return "all";
  if (raw.length === 0) return "all";

  const asStrings = raw.map((x) => String(x).trim()).filter(Boolean);
  if (asStrings.some((s) => s.toLowerCase() === "all" && !s.includes("/"))) {
    return "all";
  }

  const normalized: string[] = [];
  for (const s of asStrings) {
    const result = normalizePathEntry(s);
    if (typeof result === "string") normalized.push(result);
  }

  return [...new Set(normalized)];
}

/** Normalize a single allowlist path entry. */
export function normalizePathEntry(
  entry: string
): string | { error: string } {
  const trimmed = entry.trim();
  if (!trimmed) return { error: "empty folder path" };

  if (trimmed.toLowerCase() === "all") {
    return "all";
  }

  const rawParts = trimmed.split("/").map((p) => p.trim()).filter(Boolean);
  if (rawParts.length === 0) return { error: "empty folder path" };
  if (rawParts.length > MAX_FOLDER_DEPTH) {
    return {
      error: `folder paths can be at most ${MAX_FOLDER_DEPTH} levels deep (got "${trimmed}")`,
    };
  }

  const parts: string[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const seg = rawParts[i];
    if (seg.toLowerCase() === "all") {
      if (i !== rawParts.length - 1) {
        return { error: '"all" can only appear as the last path segment' };
      }
      if (i === 0) {
        return "all";
      }
      parts.push("all");
      continue;
    }
    const s = slugify(seg);
    if (!s) {
      return { error: `invalid folder segment "${seg}"` };
    }
    parts.push(s);
  }

  return parts.join("/");
}

/** Normalize API input into a JSON-serializable allowlist for storage. */
export function normalizeAllowlistForStorage(
  raw: unknown
): string[] | { error: string } {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return { error: "folder_allowlist must be a JSON array of strings" };
  }

  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { error: "folder_allowlist items must be strings" };
    }
    const trimmed = item.trim();
    if (!trimmed) continue;

    const result = normalizePathEntry(trimmed);
    if (typeof result !== "string") return result;

    if (result === "all") {
      return ["all"];
    }
    out.push(result);
  }

  return [...new Set(out)];
}

/**
 * Filter collection by path allowlist (up to 3 layers).
 * Granting a path includes that folder and all deeper content.
 * "parent/all" includes every direct child of parent (full subtrees).
 *
 * Partial ancestor folders (kept only to reach a deeper grant) are retained
 * as structural shells with descriptions cleared, so overview text cannot
 * mention siblings the client is not allowed to see. Collection root
 * description is also cleared when access is scoped.
 */
export function filterCollectionByAllowlist(
  collection: PostmanCollection,
  allowlist: FolderAllowlist
): PostmanCollection {
  if (allowlist === "all") return collection;

  const rules = buildRules(allowlist);
  const items = filterItemList(collection.item ?? [], "", rules);

  return {
    ...collection,
    info: {
      ...collection.info,
      // Scoped views must not surface the global overview guide
      description: undefined,
    },
    item: items,
  };
}

function filterItemList(
  items: PostmanItemOrGroup[],
  parentPath: string,
  rules: AllowlistRules
): PostmanItemOrGroup[] {
  const out: PostmanItemOrGroup[] = [];

  for (const node of items) {
    if (!isFolder(node)) {
      // Loose requests under a partial folder are omitted; only fully
      // granted folders keep their direct requests (via full node copy).
      continue;
    }

    const slug = folderSlug(node);
    if (!slug) continue;
    const path = parentPath ? `${parentPath}/${slug}` : slug;

    if (isFullyGranted(path, rules)) {
      out.push(node);
      continue;
    }

    if (!needsPartial(path, rules)) {
      continue;
    }

    const childItems = filterItemList(node.item ?? [], path, rules);
    if (childItems.length === 0) continue;

    // Structural shell only — drop overview copy that may name hidden siblings
    out.push({
      ...node,
      description: undefined,
      item: childItems,
    });
  }

  return out;
}

/** Pathnames from requests in a (possibly filtered) collection — for changelog scoping. */
export function collectRequestPathnames(
  collection: PostmanCollection
): Set<string> {
  const tree = buildTree(collection);
  const paths = new Set<string>();
  for (const req of flattenRequests(tree.nodes)) {
    try {
      const u = new URL(req.url, "https://placeholder.local");
      paths.add(normalizeHttpPath(u.pathname));
    } catch {
      const m = req.url.match(/https?:\/\/[^/]+(\/[^?\s]*)/i);
      if (m) paths.add(normalizeHttpPath(m[1]));
      else if (req.url.startsWith("/"))
        paths.add(normalizeHttpPath(req.url.split("?")[0]));
    }
  }
  return paths;
}

function normalizeHttpPath(p: string): string {
  if (!p) return "/";
  const cleaned = p.replace(/\/+$/, "");
  return cleaned || "/";
}

function pathMatchesAllowset(
  diffPath: string,
  allowed: Set<string>
): boolean {
  const n = normalizeHttpPath(diffPath);
  if (allowed.has(n)) return true;
  for (const a of allowed) {
    if (a.includes(n) || n.includes(a)) return true;
    const pattern = n.replace(/\{[^}]+\}/g, "[^/]+");
    try {
      if (new RegExp(`^${pattern}$`).test(a)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function filterChangelogDiff(
  diff: OpenApiDiffSummary,
  allowedPathnames: Set<string> | "all"
): OpenApiDiffSummary {
  if (allowedPathnames === "all") return diff;

  const filter = (items: DiffChange[]) =>
    items.filter((c) => pathMatchesAllowset(c.path, allowedPathnames));

  return {
    added: filter(diff.added),
    removed: filter(diff.removed),
    changed: filter(diff.changed),
  };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
