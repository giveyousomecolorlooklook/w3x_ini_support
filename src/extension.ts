
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';


class IniSectionDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        doc: vscode.TextDocument,
        pos: vscode.Position
    ): vscode.ProviderResult<vscode.Location | vscode.Location[]> {
        const range = doc.getWordRangeAtPosition(pos, /[\w\d]+/);
        if (!range) {return;}

        const targetId = doc.getText(range);

        // 1. 先在当前文件找
        const cur = this.findSection(doc, targetId);
        if (cur) {return cur;}

        // 2. 再扫描工作区所有 .ini
        return vscode.workspace.findFiles('**/*.ini').then(uris => {
            const locs: vscode.Location[] = [];
            for (const uri of uris) {
                if (uri.fsPath === doc.uri.fsPath) {continue;} // 已查过
                const loc = this.findSectionInFile(uri, targetId);
                if (loc) {locs.push(loc);}
            }
            return locs.length === 1 ? locs[0] : locs;
        });
    }

    private findSection(doc: vscode.TextDocument, id: string): vscode.Location | undefined {
        for (let i = 0; i < doc.lineCount; i++) {
            const line = doc.lineAt(i).text.trim();
            if (line === `[${id}]`) {
                return new vscode.Location(doc.uri, new vscode.Range(i, 0, i, 0));
            }
        }
    }

    private findSectionInFile(uri: vscode.Uri, id: string): vscode.Location | undefined {
        try {
            const content = fs.readFileSync(uri.fsPath, 'utf8');
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === `[${id}]`) {
                    return new vscode.Location(uri, new vscode.Range(i, 0, i, 0));
                }
            }
        } catch { /* ignore unreadable */ }
    }
}

class IniSectionReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Location[]> {
        const range = doc.getWordRangeAtPosition(pos, /[\w\d]+/);
        if (!range) {
            return [];
        }
        const targetId = doc.getText(range);

        // 扫描工作区所有 .ini
        return vscode.workspace.findFiles('**/*.ini').then(uris => {
            const locs: vscode.Location[] = [];
            for (const uri of uris) {
                if (token.isCancellationRequested) {
                    break;
                }
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);

                // 1) 节定义： [id]
                lines.forEach((line, idx) => {
                    if (line.trim() === `[${targetId}]`) {
                        locs.push(new vscode.Location(uri, new vscode.Range(idx, 0, idx, 0)));
                    }
                });

                // 2) 引用字段：行内出现 id
                lines.forEach((line, idx) => {
                    const idxInLine = line.indexOf(targetId);
                    if (idxInLine >= 0 && !line.trim().startsWith('[')) {
                        const pos = new vscode.Position(idx, idxInLine);
                        locs.push(new vscode.Location(uri, new vscode.Range(pos, pos.translate(0, targetId.length))));
                    }
                });
            }
            return locs;
        });
    }
}

// 新增 HoverProvider
class IniSectionHoverProvider implements vscode.HoverProvider {
    provideHover(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const range = doc.getWordRangeAtPosition(pos, /[\w\d]+/);
        if (!range) {
            return;
        }
        const targetId = doc.getText(range);

        // 扫描工作区所有 .ini 找定义
        return vscode.workspace.findFiles('**/*.ini').then(uris => {
            for (const uri of uris) {
                if (token.isCancellationRequested) {
                    break;
                }
                const lines = fs.readFileSync(uri.fsPath, 'utf8').split(/\r?\n/);
                let inside = false;
                const contentLines: string[] = [];
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed === `[${targetId}]`) {
                        inside = true;
                        contentLines.push(line);
                        continue;
                    }
                    if (inside) {
                        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                            break; // 下一个节结束
                        }
                        contentLines.push(line);
                    }
                }
                if (contentLines.length) {
                    const md = new vscode.MarkdownString();
                    md.appendCodeblock(contentLines.join('\n'), 'ini');
                    return new vscode.Hover(md, range);
                }
            }
        });
    }
}


export function activate(context: vscode.ExtensionContext) {

	console.log('w3x_ini_support is now active!');
	// 1. 语言选择器改为数组
	const iniLuaSelector = [
		{ language: 'ini', scheme: 'file' },
		{ language: 'lua',  scheme: 'file' }
	];

	// 新增 GoTo Definition
    const defProvider = vscode.languages.registerDefinitionProvider(
        iniLuaSelector,
        new IniSectionDefinitionProvider()
    );
    context.subscriptions.push(defProvider);

	// 新增：引用
    const refProvider = vscode.languages.registerReferenceProvider(
        iniLuaSelector,
        new IniSectionReferenceProvider()
    );
    context.subscriptions.push(refProvider);

	  // 新增：hover
    const hoverProvider = vscode.languages.registerHoverProvider(
        iniLuaSelector,
        new IniSectionHoverProvider()
    );
    context.subscriptions.push(hoverProvider);

}

// This method is called when your extension is deactivated
export function deactivate() {}
