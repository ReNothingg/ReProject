import * as vscode from 'vscode';
import * as path from 'node:path';
import {
    buildTree,
    renderTree,
    TreeBuildResult,
    TreeDirectoryEntry,
    TreeEntryType,
    TreeFileSystem,
    TreeWarning
} from './tree';

interface ExtensionConfig {
    ignorePatterns: string[];
    outputFileName: string;
}

const vscodeTreeFileSystem: TreeFileSystem<vscode.Uri> = {
    async readDirectory(handle) {
        const entries = await vscode.workspace.fs.readDirectory(handle);

        return entries.map(([name, type]): TreeDirectoryEntry<vscode.Uri> => ({
            name,
            type: isDirectory(type) ? TreeEntryType.Directory : TreeEntryType.File,
            handle: vscode.Uri.joinPath(handle, name)
        }));
    }
};

export function activate(context: vscode.ExtensionContext) {
    const generateFileCommand = vscode.commands.registerCommand('reproject.generateFile', async (uri?: vscode.Uri) => {
        await handleGeneration(uri, 'file');
    });

    const copyClipboardCommand = vscode.commands.registerCommand('reproject.copyClipboard', async (uri?: vscode.Uri) => {
        await handleGeneration(uri, 'clipboard');
    });

    context.subscriptions.push(generateFileCommand, copyClipboardCommand);
}

export function deactivate(): void {
    return;
}

function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('reproject');

    return {
        ignorePatterns: config.get<string[]>('ignorePatterns') ?? [],
        outputFileName: config.get<string>('outputFileName') ?? 'structure.txt'
    };
}

async function handleGeneration(uri: vscode.Uri | undefined, mode: 'file' | 'clipboard') {
    try {
        const targetUri = await resolveTargetUri(uri);

        if (!targetUri) {
            return;
        }

        const folderName = getUriBaseName(targetUri);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Генерация структуры проекта...',
            cancellable: true
        }, async (_progress, token) => {
            const config = getConfig();
            const result = await buildTree(targetUri, vscodeTreeFileSystem, {
                ignorePatterns: config.ignorePatterns,
                reservedRelativePaths: [config.outputFileName]
            }, token);

            if (token.isCancellationRequested) {
                return;
            }

            throwIfRootReadFailed(folderName, result);

            const output = formatTree(folderName, result);

            if (mode === 'file') {
                await saveToFile(targetUri, output, config.outputFileName);
            } else {
                await copyToClipboard(output);
            }

            showPartialReadWarning(result.warnings);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Ошибка: ${getErrorMessage(error)}`);
    }
}

async function resolveTargetUri(uri: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    if (!uri) {
        const [workspaceFolder] = vscode.workspace.workspaceFolders ?? [];

        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Откройте папку или используйте команду из контекстного меню.');
            return undefined;
        }

        return workspaceFolder.uri;
    }

    const stat = await vscode.workspace.fs.stat(uri);
    return isDirectory(stat.type) ? uri : getParentUri(uri);
}

async function saveToFile(baseUri: vscode.Uri, content: string, fileName: string) {
    const fileUri = vscode.Uri.joinPath(baseUri, fileName);
    const data = new TextEncoder().encode(content);

    try {
        await vscode.workspace.fs.writeFile(fileUri, data);
        vscode.window.showInformationMessage(`Структура сохранена: ${fileName}`);

        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    } catch (error) {
        vscode.window.showErrorMessage(`Ошибка записи файла: ${getErrorMessage(error)}`);
    }
}

async function copyToClipboard(content: string) {
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Структура скопирована в буфер обмена.');
}

function isDirectory(type: vscode.FileType): boolean {
    return (type & vscode.FileType.Directory) !== 0;
}

function getParentUri(uri: vscode.Uri): vscode.Uri {
    return uri.with({ path: path.posix.dirname(uri.path) });
}

function getUriBaseName(uri: vscode.Uri): string {
    return path.posix.basename(uri.path.replace(/\/$/, ''));
}

function formatTree(rootName: string, result: TreeBuildResult): string {
    return `${rootName}/\n${renderTree(result.nodes)}`;
}

function throwIfRootReadFailed(rootName: string, result: TreeBuildResult): void {
    const rootWarning = result.warnings.find((warning) => warning.relativePath.length === 0);

    if (!rootWarning) {
        return;
    }

    throw new Error(`Не удалось прочитать "${rootName}": ${rootWarning.message}`);
}

function showPartialReadWarning(warnings: TreeWarning[]): void {
    const nestedWarnings = warnings.filter((warning) => warning.relativePath.length > 0);

    if (nestedWarnings.length === 0) {
        return;
    }

    const preview = nestedWarnings
        .slice(0, 3)
        .map((warning) => warning.relativePath)
        .join(', ');
    const remainingCount = nestedWarnings.length - Math.min(nestedWarnings.length, 3);
    const suffix = remainingCount > 0 ? ` и ещё ${remainingCount}` : '';

    vscode.window.showWarningMessage(`Часть каталогов не удалось прочитать: ${preview}${suffix}.`);
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }

    return 'Unknown error';
}
