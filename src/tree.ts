export interface CancellationSignal {
    isCancellationRequested: boolean;
}

export enum TreeEntryType {
    File = 'file',
    Directory = 'directory'
}

export interface TreeDirectoryEntry<THandle> {
    name: string;
    type: TreeEntryType;
    handle: THandle;
}

export interface TreeNode {
    name: string;
    type: TreeEntryType;
    children?: TreeNode[];
}

export interface TreeWarning {
    relativePath: string;
    message: string;
}

export interface TreeBuildOptions {
    ignorePatterns: string[];
    reservedRelativePaths?: string[];
}

export interface TreeBuildResult {
    nodes: TreeNode[];
    warnings: TreeWarning[];
}

export interface TreeFileSystem<THandle> {
    readDirectory(handle: THandle): Promise<TreeDirectoryEntry<THandle>[]>;
}

interface CompiledIgnorePattern {
    regex: RegExp;
    useBasename: boolean;
}

type IgnoreMatcher = (relativePath: string, name: string) => boolean;

export function normalizeRelativePath(value: string): string {
    return value
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/$/, '');
}

export function sortEntries<THandle>(entries: TreeDirectoryEntry<THandle>[]): TreeDirectoryEntry<THandle>[] {
    return [...entries].sort((left, right) => {
        if (left.type === right.type) {
            return left.name.localeCompare(right.name);
        }

        return left.type === TreeEntryType.Directory ? -1 : 1;
    });
}

export function renderTree(nodes: TreeNode[], prefix = ''): string {
    let output = '';

    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const isLast = index === nodes.length - 1;
        const connector = isLast ? '└── ' : '├── ';

        output += `${prefix}${connector}${node.name}\n`;

        if (node.type === TreeEntryType.Directory) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            output += renderTree(node.children ?? [], childPrefix);
        }
    }

    return output;
}

export async function buildTree<THandle>(
    rootHandle: THandle,
    fileSystem: TreeFileSystem<THandle>,
    options: TreeBuildOptions,
    signal: CancellationSignal
): Promise<TreeBuildResult> {
    const warnings: TreeWarning[] = [];
    const ignoreEntry = createIgnoreMatcher(options.ignorePatterns, options.reservedRelativePaths ?? []);

    const nodes = await readDirectoryRecursive(rootHandle, '', fileSystem, ignoreEntry, signal, warnings);

    return { nodes, warnings };
}

function createIgnoreMatcher(patterns: string[], reservedRelativePaths: string[]): IgnoreMatcher {
    const compiledPatterns = patterns
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
        .map(compileIgnorePattern);

    const reservedPaths = new Set(
        reservedRelativePaths
            .map((value) => normalizeRelativePath(value.trim()))
            .filter((value) => value.length > 0)
    );

    return (relativePath, name) => {
        const normalizedPath = normalizeRelativePath(relativePath);
        const normalizedName = normalizeRelativePath(name);

        if (reservedPaths.has(normalizedPath)) {
            return true;
        }

        return compiledPatterns.some((pattern) => {
            const candidate = pattern.useBasename ? normalizedName : normalizedPath;
            return pattern.regex.test(candidate);
        });
    };
}

function compileIgnorePattern(pattern: string): CompiledIgnorePattern {
    const normalizedPattern = normalizeRelativePath(pattern);
    const useBasename = !normalizedPattern.includes('/');

    return {
        regex: globToRegExp(normalizedPattern),
        useBasename
    };
}

function globToRegExp(pattern: string): RegExp {
    if (pattern.endsWith('/**')) {
        const basePattern = pattern.slice(0, -3);
        return new RegExp(`^${globBodyToRegExp(basePattern)}(?:/.*)?$`);
    }

    return new RegExp(`^${globBodyToRegExp(pattern)}$`);
}

function globBodyToRegExp(pattern: string): string {
    let regex = '';

    for (let index = 0; index < pattern.length; index += 1) {
        const current = pattern[index];
        const next = pattern[index + 1];

        if (current === '*') {
            if (next === '*') {
                regex += '.*';
                index += 1;
            } else {
                regex += '[^/]*';
            }
            continue;
        }

        if (current === '?') {
            regex += '[^/]';
            continue;
        }

        regex += escapeRegExp(current);
    }

    return regex;
}

function escapeRegExp(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

async function readDirectoryRecursive<THandle>(
    handle: THandle,
    currentRelativePath: string,
    fileSystem: TreeFileSystem<THandle>,
    ignoreEntry: IgnoreMatcher,
    signal: CancellationSignal,
    warnings: TreeWarning[]
): Promise<TreeNode[]> {
    if (signal.isCancellationRequested) {
        return [];
    }

    let entries: TreeDirectoryEntry<THandle>[];

    try {
        entries = await fileSystem.readDirectory(handle);
    } catch (error) {
        warnings.push({
            relativePath: currentRelativePath,
            message: getErrorMessage(error)
        });
        return [];
    }

    const visibleEntries = sortEntries(
        entries.filter((entry) => {
            const relativePath = joinRelativePath(currentRelativePath, entry.name);
            return !ignoreEntry(relativePath, entry.name);
        })
    );

    const nodes: TreeNode[] = [];

    for (const entry of visibleEntries) {
        if (signal.isCancellationRequested) {
            return nodes;
        }

        const relativePath = joinRelativePath(currentRelativePath, entry.name);

        if (entry.type === TreeEntryType.Directory) {
            const children = await readDirectoryRecursive(
                entry.handle,
                relativePath,
                fileSystem,
                ignoreEntry,
                signal,
                warnings
            );

            nodes.push({
                name: entry.name,
                type: entry.type,
                children
            });

            continue;
        }

        nodes.push({
            name: entry.name,
            type: entry.type
        });
    }

    return nodes;
}

function joinRelativePath(basePath: string, name: string): string {
    if (basePath.length === 0) {
        return normalizeRelativePath(name);
    }

    return normalizeRelativePath(`${basePath}/${name}`);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }

    return 'Unknown error';
}
