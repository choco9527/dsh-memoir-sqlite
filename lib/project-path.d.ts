export interface ProjectPathRelocation {
    readonly from: string;
    readonly to: string;
}
/** Normalize a project key, preserving POSIX case and folding Windows drive paths. */
export declare function projectKey(cwd: string): string;
/** Validate host-owned mappings and resolve the most specific old directory prefix once. */
export declare function projectPathResolver(input?: readonly ProjectPathRelocation[]): (cwd: string) => string;
