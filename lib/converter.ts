import postmanToOpenApi from "postman-to-openapi";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { load as yamlLoad } from "js-yaml";

export async function convertPostmanToOpenApi(
  collection: object
): Promise<object> {
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const inputPath = path.join(tmpDir, `postman-${timestamp}.json`);
  const outputPath = path.join(tmpDir, `openapi-${timestamp}.yaml`);

  await fs.writeFile(inputPath, JSON.stringify(collection), "utf-8");

  try {
    await postmanToOpenApi(inputPath, outputPath, { defaultTag: "General" });
    const raw = await fs.readFile(outputPath, "utf-8");
    const parsed = yamlLoad(raw);

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Converted spec is not a valid object");
    }

    return restructureTags(parsed as Record<string, unknown>);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * postman-to-openapi flattens nested folders into tags like "Folder > Subfolder".
 * This function restructures them into x-tagGroups so Scalar renders a proper hierarchy.
 */
function restructureTags(spec: Record<string, unknown>): Record<string, unknown> {
  const tags = (spec.tags as Array<{ name: string; description?: string }>) ?? [];
  const paths = (spec.paths as Record<string, unknown>) ?? {};

  // Build a map of tag name → operations
  const tagToOps: Record<string, string[]> = {};
  for (const tag of tags) {
    tagToOps[tag.name] = [];
  }

  // Build tree: { "Folder": { "Subfolder": ["tag1", "tag2"] } }
  const tree: Record<string, Record<string, string[]>> = {};

  for (const tag of tags) {
    const parts = tag.name.split(">").map((p) => p.trim());

    if (parts.length === 1) {
      // Top-level tag with no parent
      if (!tree[parts[0]]) {
        tree[parts[0]] = {};
      }
    } else if (parts.length >= 2) {
      const folder = parts[0];
      const rest = parts.slice(1).join(" > ");
      if (!tree[folder]) {
        tree[folder] = {};
      }
      if (!tree[folder][rest]) {
        tree[folder][rest] = [];
      }
      tree[folder][rest].push(tag.name);
    }
  }

  // Build x-tagGroups for Scalar sidebar hierarchy
  const xTagGroups = Object.entries(tree).map(([folder, subfolders]) => {
    const subTags = Object.keys(subfolders).length > 0
      ? Object.values(subfolders).flat()
      : tags
          .filter((t) => t.name === folder)
          .map((t) => t.name);

    return {
      name: folder,
      tags: subTags.length > 0 ? subTags : [folder],
    };
  });

  return {
    ...spec,
    "x-tagGroups": xTagGroups,
  };
}