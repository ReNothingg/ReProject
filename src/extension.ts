import * as vscode from 'vscode';
import * as path from 'path';

interface ExtensionConfig {
    ignorePatterns: string[];
    outputFileName: string;
}

export function activate(context: vscode.ExtensionContext) {

    let cmdFile = vscode.commands.registerCommand('reproject.generateFile', async (uri: vscode.Uri) => {
        await handleGeneration(uri, 'file');
    });

    let cmdClipboard = vscode.commands.registerCommand('reproject.copyClipboard', async (uri: vscode.Uri) => {
        await handleGeneration(uri, 'clipboard');
    });

    context.subscriptions.push(cmdFile, cmdClipboard);
}

function getConfig(): ExtensionConfig {
    const config = vscode.workspace.getConfiguration('reproject');
    return {
        ignorePatterns: config.get<string[]>('ignorePatterns') || [],
        outputFileName: config.get<string>('outputFileName') || 'structure.txt'
    };
}

async function handleGeneration(uri: vscode.Uri, mode: 'file' | 'clipboard') {
    if (!uri) {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            uri = vscode.workspace.workspaceFolders[0].uri;
        } else {
            vscode.window.showErrorMessage('Откройте папку или используйте контекстное меню.');
            return;
        }
    }

    try {
        const stat = await vscode.workspace.fs.stat(uri);

        let targetUri = uri;
        if (stat.type === vscode.FileType.File) {
            targetUri = vscode.Uri.joinPath(uri, '..');
        }

        const folderName = path.basename(targetUri.fsPath);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Генерация структуры проекта...",
            cancellable: true
        }, async (progress, token) => {

            const config = getConfig();
            const tree = await generateTree(targetUri, "", config, token);

            if (token.isCancellationRequested) {
                return;
            }

            const finalOutput = `${folderName}/\n${tree}`;

            if (mode === 'file') {
                await saveToFile(targetUri, finalOutput, config.outputFileName);
            } else {
                await copyToClipboard(finalOutput);
            }
        });

    } catch (err: any) {
        vscode.window.showErrorMessage(`Ошибка: ${err.message}`);
    }
}

async function generateTree(
    dirUri: vscode.Uri,
    prefix: string,
    config: ExtensionConfig,
    token: vscode.CancellationToken
): Promise<string> {

    if (token.isCancellationRequested) {
        return "";
    }

    let output = "";
    let items: [string, vscode.FileType][];

    try {
        items = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (e) {
        return "";
    }

    items = items.filter(([name]) => !config.ignorePatterns.includes(name));

    items.sort((a, b) => {
        const [nameA, typeA] = a;
        const [nameB, typeB] = b;

        const isDirA = (typeA & vscode.FileType.Directory) !== 0;
        const isDirB = (typeB & vscode.FileType.Directory) !== 0;

        if (isDirA === isDirB) {
            return nameA.localeCompare(nameB);
        }
        return isDirA ? -1 : 1;
    });

    for (let i = 0; i < items.length; i++) {
        if (token.isCancellationRequested) return "";

        const [name, type] = items[i];
        const isLast = i === items.length - 1;
        const itemUri = vscode.Uri.joinPath(dirUri, name);

        const isDir = (type & vscode.FileType.Directory) !== 0;

        const connector = isLast ? "└── " : "├── ";
        output += `${prefix}${connector}${name}\n`;

        if (isDir) {
            const childPrefix = prefix + (isLast ? "    " : "│   ");
            output += await generateTree(itemUri, childPrefix, config, token);
        }
    }

    return output;
}

async function saveToFile(baseUri: vscode.Uri, content: string, fileName: string) {
    const fileUri = vscode.Uri.joinPath(baseUri, fileName);

    const encoder = new TextEncoder();
    const data = encoder.encode(content);

    try {
        await vscode.workspace.fs.writeFile(fileUri, data);
        vscode.window.showInformationMessage(`Структура сохранена: ${fileName}`);

        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    } catch (err: any) {
        vscode.window.showErrorMessage('Ошибка записи файла: ' + err.message);
    }
}

async function copyToClipboard(content: string) {
    await vscode.env.clipboard.writeText(content);
    vscode.window.showInformationMessage('Структура скопирована в буфер обмена!');
}

export function deactivate() {}