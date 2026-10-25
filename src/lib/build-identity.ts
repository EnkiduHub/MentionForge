import { BUILD_AT, BUILD_SHA } from "./build-info";

export type BuildIdentity = {
  sha: string;
  built_at: string | null;
};

export function getBuildInfo(): BuildIdentity {
  const sha = typeof BUILD_SHA === "string" && BUILD_SHA.length > 0 ? BUILD_SHA : "dev";
  if (sha === "dev") {
    return { sha: "dev", built_at: null };
  }
  const built_at = typeof BUILD_AT === "string" && BUILD_AT.length > 0 ? BUILD_AT : null;
  return { sha, built_at };
}
