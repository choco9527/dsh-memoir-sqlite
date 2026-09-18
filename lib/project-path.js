/** Explicit workspace moves supplied by the embedding application, independent of symlinks. */
import { posix, win32 } from 'node:path';
/** Normalize a project key, preserving POSIX case and folding Windows drive paths. */
export function projectKey(cwd) {
    const raw = String(cwd).replace(/[\\/]+$/, '');
    const drive = /^([A-Za-z]):/.exec(raw);
    return drive === null ? raw : (drive[1] + ':' + raw.slice(2)).toLowerCase().replace(/\\/g, '/');
}
function absoluteDirectory(value) {
    if (typeof value !== 'string' || value.includes('\0'))
        throw new Error('Invalid memory relocation path');
    const path = /^[A-Za-z]:|^\\\\/.test(value) ? win32 : posix;
    const normalized = path.normalize(value);
    if (!path.isAbsolute(value) || normalized === path.parse(normalized).root) {
        throw new Error('Memory relocations require absolute non-root directories');
    }
    return normalized.replace(/[\\/]+$/, '');
}
function contains(parent, child) {
    return child === parent || child.startsWith(parent + '/');
}
/** Validate host-owned mappings and resolve the most specific old directory prefix once. */
export function projectPathResolver(input = []) {
    if (!Array.isArray(input))
        throw new Error('Invalid memory relocations');
    const mappings = input.map(row => {
        if (typeof row !== 'object' || row === null)
            throw new Error('Invalid memory relocation');
        const from = projectKey(absoluteDirectory(row.from));
        const to = absoluteDirectory(row.to);
        return { from, to, targetKey: projectKey(to) };
    }).sort((a, b) => b.from.length - a.from.length);
    if (new Set(mappings.map(row => row.from)).size !== mappings.length
        || mappings.some(row => mappings.some(other => contains(other.from, row.targetKey)))) {
        throw new Error('Memory relocation sources must be unique and targets must not chain or cycle');
    }
    return cwd => {
        const key = projectKey(cwd);
        const mapping = mappings.find(row => contains(row.from, key));
        if (!mapping)
            return cwd;
        return mapping.to + key.slice(mapping.from.length);
    };
}
