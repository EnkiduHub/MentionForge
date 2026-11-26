/**
 * llms.txt v2 discovery link.
 * https://llmstxt.org/ (August 10, 2026): rel="describedby" points at the llms.txt
 * that covers a page. The file at the origin root covers every URL under `/`.
 * The header form is `Link: </llms.txt>; rel="describedby"`.
 */
export const LLMS_DESCRIBEDBY_PATH = "/llms.txt";
export const LLMS_DESCRIBEDBY_HEADER = '</llms.txt>; rel="describedby"';

const DESCRIBED_BY_PATHS = new Set(["/llms.txt", "/llms-full.txt", "/skill.md"]);

export function shouldDescribeForAgents(pathname: string, contentType: string | null): boolean {
  if (DESCRIBED_BY_PATHS.has(pathname)) return true;
  return (contentType ?? "").toLowerCase().includes("text/html");
}

/** Add the describedby link once. Existing Link values are kept. */
export function appendDescribedBy(headers: Headers): void {
  const current = headers.get("Link");
  if (current && /rel\s*=\s*"?describedby"?/i.test(current)) return;
  headers.set("Link", current ? `${current}, ${LLMS_DESCRIBEDBY_HEADER}` : LLMS_DESCRIBEDBY_HEADER);
}
