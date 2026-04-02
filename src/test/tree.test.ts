import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
    buildTree,
    renderTree,
    TreeBuildOptions,
    TreeDirectoryEntry,
    TreeEntryType,
    TreeFileSystem
} from '../tree';

type MockHandle = string;

class MockFileSystem implements TreeFileSystem<MockHandle> {
    constructor(
        private readonly entries: Record<string, TreeDirectoryEntry<MockHandle>[]>,
        private readonly failures: Map<string, string> = new Map()
    ) {}

    async readDirectory(handle: MockHandle): Promise<TreeDirectoryEntry<MockHandle>[]> {
        const failureMessage = this.failures.get(handle);

        if (failureMessage) {
            throw new Error(failureMessage);
        }

        return this.entries[handle] ?? [];
    }
}

test('buildTree sorts directories before files and renders a stable tree', async () => {
    const fileSystem = new MockFileSystem({
        root: [
            createFile('zeta.ts'),
            createDirectory('src', 'root/src'),
            createFile('README.md'),
            createDirectory('docs', 'root/docs')
        ],
        'root/docs': [
            createFile('intro.md')
        ],
        'root/src': [
            createFile('index.ts'),
            createDirectory('utils', 'root/src/utils')
        ],
        'root/src/utils': [
            createFile('api.ts')
        ]
    });

    const result = await buildTree('root', fileSystem, defaultOptions(), activeSignal);

    assert.deepEqual(result.warnings, []);
    assert.equal(
        renderTree(result.nodes),
        [
            '├── docs',
            '│   └── intro.md',
            '├── src',
            '│   ├── utils',
            '│   │   └── api.ts',
            '│   └── index.ts',
            '├── README.md',
            '└── zeta.ts',
            ''
        ].join('\n')
    );
});

test('buildTree respects basename and path-based glob ignore patterns', async () => {
    const fileSystem = new MockFileSystem({
        root: [
            createDirectory('coverage', 'root/coverage'),
            createDirectory('node_modules', 'root/node_modules'),
            createDirectory('src', 'root/src'),
            createFile('latest.log'),
            createFile('package.json')
        ],
        'root/coverage': [
            createFile('coverage-final.json')
        ],
        'root/node_modules': [
            createFile('library.js')
        ],
        'root/src': [
            createDirectory('coverage', 'root/src/coverage'),
            createFile('extension.ts')
        ],
        'root/src/coverage': [
            createFile('nested.json')
        ]
    });

    const result = await buildTree('root', fileSystem, {
        ignorePatterns: ['node_modules', '*.log', 'coverage/**']
    }, activeSignal);

    assert.equal(
        renderTree(result.nodes),
        [
            '├── src',
            '│   ├── coverage',
            '│   │   └── nested.json',
            '│   └── extension.ts',
            '└── package.json',
            ''
        ].join('\n')
    );
});

test('buildTree excludes the generated output file only at the root level', async () => {
    const fileSystem = new MockFileSystem({
        root: [
            createDirectory('nested', 'root/nested'),
            createFile('structure.txt'),
            createFile('README.md')
        ],
        'root/nested': [
            createFile('structure.txt')
        ]
    });

    const result = await buildTree('root', fileSystem, {
        ignorePatterns: [],
        reservedRelativePaths: ['structure.txt']
    }, activeSignal);

    assert.equal(
        renderTree(result.nodes),
        [
            '├── nested',
            '│   └── structure.txt',
            '└── README.md',
            ''
        ].join('\n')
    );
});

test('buildTree reports nested read failures and keeps the rest of the tree', async () => {
    const fileSystem = new MockFileSystem({
        root: [
            createDirectory('docs', 'root/docs'),
            createDirectory('src', 'root/src')
        ],
        'root/src': [
            createFile('extension.ts')
        ]
    }, new Map([
        ['root/docs', 'Access denied']
    ]));

    const result = await buildTree('root', fileSystem, defaultOptions(), activeSignal);

    assert.deepEqual(result.warnings, [
        {
            relativePath: 'docs',
            message: 'Access denied'
        }
    ]);
    assert.equal(
        renderTree(result.nodes),
        [
            '├── docs',
            '└── src',
            '    └── extension.ts',
            ''
        ].join('\n')
    );
});

function defaultOptions(): TreeBuildOptions {
    return {
        ignorePatterns: []
    };
}

function createDirectory(name: string, handle: MockHandle): TreeDirectoryEntry<MockHandle> {
    return {
        name,
        type: TreeEntryType.Directory,
        handle
    };
}

function createFile(name: string): TreeDirectoryEntry<MockHandle> {
    return {
        name,
        type: TreeEntryType.File,
        handle: name
    };
}

const activeSignal = {
    isCancellationRequested: false
};
