import { notFound } from "next/navigation";

/**
 * Docs require a client access id:
 * /{brand}/{service}/{clientId}
 */
export default function DocsMissingClientPage() {
  notFound();
}
