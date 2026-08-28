export interface DiffChange {
  kind: "added" | "removed" | "changed";
  path: string;
  method?: string;
  detail: string;
}

export interface OpenApiDiffSummary {
  added: DiffChange[];
  removed: DiffChange[];
  changed: DiffChange[];
}

type PathItem = Record<string, unknown>;

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

function pathOps(paths: Record<string, PathItem> | undefined): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!paths || typeof paths !== "object") return map;

  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    const methods = new Set<string>();
    for (const key of Object.keys(item)) {
      if (HTTP_METHODS.has(key.toLowerCase())) {
        methods.add(key.toUpperCase());
      }
    }
    if (methods.size > 0) map.set(path, methods);
  }
  return map;
}

/**
 * Lightweight OpenAPI path/method diff for changelog entries.
 */
export function diffOpenApiSpecs(
  previous: unknown,
  current: unknown
): OpenApiDiffSummary {
  const prevPaths =
    previous && typeof previous === "object"
      ? pathOps((previous as { paths?: Record<string, PathItem> }).paths)
      : new Map<string, Set<string>>();
  const currPaths =
    current && typeof current === "object"
      ? pathOps((current as { paths?: Record<string, PathItem> }).paths)
      : new Map<string, Set<string>>();

  const added: DiffChange[] = [];
  const removed: DiffChange[] = [];
  const changed: DiffChange[] = [];

  const allPaths = new Set([...prevPaths.keys(), ...currPaths.keys()]);

  for (const path of allPaths) {
    const prev = prevPaths.get(path);
    const curr = currPaths.get(path);

    if (!prev && curr) {
      for (const method of curr) {
        added.push({
          kind: "added",
          path,
          method,
          detail: `Added ${method} ${path}`,
        });
      }
      continue;
    }

    if (prev && !curr) {
      for (const method of prev) {
        removed.push({
          kind: "removed",
          path,
          method,
          detail: `Removed ${method} ${path}`,
        });
      }
      continue;
    }

    if (prev && curr) {
      for (const method of curr) {
        if (!prev.has(method)) {
          added.push({
            kind: "added",
            path,
            method,
            detail: `Added ${method} ${path}`,
          });
        }
      }
      for (const method of prev) {
        if (!curr.has(method)) {
          removed.push({
            kind: "removed",
            path,
            method,
            detail: `Removed ${method} ${path}`,
          });
        }
      }
    }
  }

  // Stable sort for readable changelogs
  const byPath = (a: DiffChange, b: DiffChange) =>
    a.path.localeCompare(b.path) || (a.method ?? "").localeCompare(b.method ?? "");

  added.sort(byPath);
  removed.sort(byPath);
  changed.sort(byPath);

  return { added, removed, changed };
}

export function isEmptyDiff(diff: OpenApiDiffSummary): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  );
}
