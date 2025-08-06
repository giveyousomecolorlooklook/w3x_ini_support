
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 跳转定义
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
// 查找引用
class IniSectionReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Location[]> {
        const range = doc.getWordRangeAtPosition(pos, /[\w\d]+/);
        if (!range) { return []; }
        const targetId = doc.getText(range);

        // 同时扫描 .ini 和 .lua
        return vscode.workspace.findFiles('**/*.{ini,lua}').then(uris => {
            const locs: vscode.Location[] = [];
            for (const uri of uris) {
                if (token.isCancellationRequested) { break; }

                const content = fs.readFileSync(uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);

                lines.forEach((line, idx) => {
                    const trimmed = line.trim();

                    // 1) .ini：行内引用（排除节名）
                    if (uri.fsPath.endsWith('.ini') && !trimmed.startsWith('[')) {
                        let offset = 0;
                        let idxInLine = -1;
                        while ((idxInLine = line.indexOf(targetId, offset)) !== -1) {
                            const posStart = new vscode.Position(idx, idxInLine);
                            locs.push(new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length))));
                            offset = idxInLine + targetId.length;
                        }
                    }

                    // 2) .lua：双引号或单引号里的 id
                    if (uri.fsPath.endsWith('.lua')) {
                        // 匹配 "id" 或 'id'
                        const luaRegex = new RegExp(`(['"])${targetId}\\1`, 'g');
                        let match;
                        while ((match = luaRegex.exec(line)) !== null) {
                            const posStart = new vscode.Position(idx, match.index + 1); // +1 跳过引号
                            locs.push(new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length))));
                        }
                    }
                });
            }
            return locs;
        });
    }
}

// 鼠标悬停
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

class IniSectionCompletionProvider implements vscode.CompletionItemProvider {
    /**
     * 提供补全项，基于工作区所有 .ini 文件中的节名及其后面的内容作为detail
     */
    async provideCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const uris = await vscode.workspace.findFiles('**/*.ini');
        const sectionMap = new Map<string, string>(); // key: section id, value: detail内容

        for (const uri of uris) {
            if (token.isCancellationRequested) {
                break;
            }
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);

                let currentSection = '';
                let detailLines: string[] = [];

                for (const line of lines) {
                    const sectionMatch = line.match(/^\[(.+?)\]$/);
                    if (sectionMatch) {
                        // 保存上一个节的detail
                        if (currentSection) {
                            sectionMap.set(currentSection, detailLines.join('\n').trim());
                        }
                        currentSection = sectionMatch[1];
                        detailLines = [];
                    } else if (currentSection) {
                        // 收集当前节的内容作为detail
                        if (line.trim() !== '') {
                            detailLines.push(line);
                        }
                    }
                }
                // 保存最后一个节的detail
                if (currentSection) {
                    sectionMap.set(currentSection, detailLines.join('\n').trim());
                }
            } catch {
                // 忽略无法读取的文件
            }
        }

        return Array.from(sectionMap.entries()).map(([id, detail]) => {
            const item = new vscode.CompletionItem(id, vscode.CompletionItemKind.Reference);
            item.detail = detail || 'ini section';

            const wordRange = doc.getWordRangeAtPosition(pos, /[\w\d]+/);
            item.range = wordRange ?? new vscode.Range(pos, pos);
            item.insertText = id;
            return item;
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

	// 新增：补全
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		iniLuaSelector,
		new IniSectionCompletionProvider(),
		".","\"",",","'"

	);
	context.subscriptions.push(completionProvider);

}

// This method is called when your extension is deactivated
export function deactivate() {}
