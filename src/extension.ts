
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 配置项缓存管理器
class ConfigSectionManager {
    private static instance: ConfigSectionManager;
    private sectionCache: Map<string, vscode.Location> = new Map();
    private lastScanTime: number = 0;

    static getInstance(): ConfigSectionManager {
        if (!ConfigSectionManager.instance) {
            ConfigSectionManager.instance = new ConfigSectionManager();
        }
        return ConfigSectionManager.instance;
    }

    async scanAllSections(): Promise<void> {
        const now = Date.now();
        // 缓存5秒，避免频繁扫描
        if (now - this.lastScanTime < 5000) {
            return;
        }

        this.sectionCache.clear();
        const uris = await vscode.workspace.findFiles('**/*.ini');
        
        for (const uri of uris) {
            try {
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);
                
                for (let i = 0; i < lines.length; i++) {
                    const match = lines[i].match(/^\[(.+?)\]$/);
                    if (match) {
                        const sectionId = match[1];
                        this.sectionCache.set(sectionId, new vscode.Location(uri, new vscode.Range(i, 0, i, 0)));
                    }
                }
            } catch {
                // 忽略无法读取的文件
            }
        }
        
        this.lastScanTime = now;
    }

    getAllSectionIds(): string[] {
        return Array.from(this.sectionCache.keys());
    }

    getSectionLocation(sectionId: string): vscode.Location | undefined {
        return this.sectionCache.get(sectionId);
    }

    findMatchingSectionAtPosition(doc: vscode.TextDocument, pos: vscode.Position): { sectionId: string, range: vscode.Range } | null {
        const line = doc.lineAt(pos.line).text;
        const sectionIds = this.getAllSectionIds();
        
        // 按长度降序排序，优先匹配更长的配置项
        sectionIds.sort((a, b) => b.length - a.length);
        
        for (const sectionId of sectionIds) {
            // 在当前行查找所有匹配位置
            let searchIndex = 0;
            let foundIndex = -1;
            
            while ((foundIndex = line.indexOf(sectionId, searchIndex)) !== -1) {
                const startPos = new vscode.Position(pos.line, foundIndex);
                const endPos = new vscode.Position(pos.line, foundIndex + sectionId.length);
                const range = new vscode.Range(startPos, endPos);
                
                // 检查点击位置是否在这个范围内
                if (range.contains(pos)) {
                    return { sectionId, range };
                }
                
                searchIndex = foundIndex + 1;
            }
        }
        
        return null;
    }
}

// 跳转定义
class IniSectionDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        doc: vscode.TextDocument,
        pos: vscode.Position
    ): Promise<vscode.Location | vscode.Location[] | undefined> {
        const manager = ConfigSectionManager.getInstance();
        await manager.scanAllSections();
        
        const match = manager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return;
        }

        const location = manager.getSectionLocation(match.sectionId);
        return location;
    }
}
// 查找引用
class IniSectionReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        const manager = ConfigSectionManager.getInstance();
        await manager.scanAllSections();
        
        const match = manager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return [];
        }

        const targetId = match.sectionId;
        const uris = await vscode.workspace.findFiles('**/*.{ini,lua,txt,ts,md}');
        const locs: vscode.Location[] = [];

        for (const uri of uris) {
            if (token.isCancellationRequested) {
                break;
            }

            try {
                const content = fs.readFileSync(uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);

                lines.forEach((line, idx) => {
                    const trimmed = line.trim();

                    // 1) .ini：行内引用（排除节名定义）
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
                        const luaRegex = new RegExp(`(['"])${this.escapeRegex(targetId)}\\1`, 'g');
                        let match;
                        while ((match = luaRegex.exec(line)) !== null) {
                            const posStart = new vscode.Position(idx, match.index + 1); // +1 跳过引号
                            locs.push(new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length))));
                        }
                    }

                    // 3) .ts：双引号或单引号里的 id，类似 lua
                    if (uri.fsPath.endsWith('.ts')) {
                        const tsRegex = new RegExp(`(['"\`])${this.escapeRegex(targetId)}\\1`, 'g');
                        let match;
                        while ((match = tsRegex.exec(line)) !== null) {
                            const posStart = new vscode.Position(idx, match.index + 1); // +1 跳过引号
                            locs.push(new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length))));
                        }
                    }

                    // 4) .txt 和 .md：直接文本匹配
                    if (uri.fsPath.endsWith('.txt') || uri.fsPath.endsWith('.md')) {
                        let offset = 0;
                        let idxInLine = -1;
                        while ((idxInLine = line.indexOf(targetId, offset)) !== -1) {
                            const posStart = new vscode.Position(idx, idxInLine);
                            locs.push(new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length))));
                            offset = idxInLine + targetId.length;
                        }
                    }
                });
            } catch {
                // 忽略无法读取的文件
            }
        }

        // 如果包含定义，也添加定义位置
        if (context.includeDeclaration) {
            const defLocation = manager.getSectionLocation(targetId);
            if (defLocation) {
                locs.push(defLocation);
            }
        }

        return locs;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

// 鼠标悬停
class IniSectionHoverProvider implements vscode.HoverProvider {
    async provideHover(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const manager = ConfigSectionManager.getInstance();
        await manager.scanAllSections();
        
        const match = manager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return;
        }

        const targetId = match.sectionId;
        const defLocation = manager.getSectionLocation(targetId);
        if (!defLocation) {
            return;
        }

        try {
            const content = fs.readFileSync(defLocation.uri.fsPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const startLine = defLocation.range.start.line;
            
            const contentLines: string[] = [];
            let inside = false;
            
            for (let i = startLine; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                if (trimmed === `[${targetId}]`) {
                    inside = true;
                    contentLines.push(line);
                    continue;
                }
                
                if (inside) {
                    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                        break; // 遇到下一个节，结束
                    }
                    contentLines.push(line);
                }
            }
            
            if (contentLines.length) {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(contentLines.join('\n'), 'ini');
                return new vscode.Hover(md, match.range);
            }
        } catch {
            // 忽略文件读取错误
        }
        
        return;
    }
}
// 补全
class IniSectionCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const manager = ConfigSectionManager.getInstance();
        await manager.scanAllSections();
        
        const sectionIds = manager.getAllSectionIds();
        const items: vscode.CompletionItem[] = [];
        
        for (const sectionId of sectionIds) {
            if (token.isCancellationRequested) {
                break;
            }
            
            const item = new vscode.CompletionItem(sectionId, vscode.CompletionItemKind.Reference);
            
            // 获取节的详细内容
            const location = manager.getSectionLocation(sectionId);
            if (location) {
                try {
                    const content = fs.readFileSync(location.uri.fsPath, 'utf8');
                    const lines = content.split(/\r?\n/);
                    const startLine = location.range.start.line;
                    
                    const detailLines: string[] = [];
                    let inside = false;
                    
                    for (let i = startLine; i < lines.length; i++) {
                        const line = lines[i];
                        const trimmed = line.trim();
                        
                        if (trimmed === `[${sectionId}]`) {
                            inside = true;
                            continue; // 不包含节名本身
                        }
                        
                        if (inside) {
                            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                                break; // 遇到下一个节，结束
                            }
                            if (trimmed !== '') {
                                detailLines.push(line);
                            }
                        }
                    }
                    
                    if (detailLines.length > 0) {
                        item.documentation = new vscode.MarkdownString('```ini\n[' + sectionId + ']\n' + detailLines.join('\n') + '\n```');
                        item.documentation.isTrusted = true;
                    }
                } catch {
                    // 忽略文件读取错误
                }
            }
            
            // 设置插入范围（替换当前正在输入的内容）
            const line = doc.lineAt(pos.line).text;
            let start = pos.character;
            let end = pos.character;
            
            // 向前查找单词边界
            while (start > 0 && /[\w\d]/.test(line[start - 1])) {
                start--;
            }
            
            // 向后查找单词边界
            while (end < line.length && /[\w\d]/.test(line[end])) {
                end++;
            }
            
            if (start < end) {
                item.range = new vscode.Range(pos.line, start, pos.line, end);
            }
            
            item.insertText = sectionId;
            items.push(item);
        }
        
        return items;
    }
}




export function activate(context: vscode.ExtensionContext) {

	console.log('w3x_ini_support is now active!');
	// 1. 语言选择器改为数组
	const iniLuaSelector = [
		{ language: 'ini', scheme: 'file' },
		{ language: 'lua', scheme: 'file' },
		{ language: 'plaintext', scheme: 'file' }, // txt 文件
		{ language: 'typescript', scheme: 'file' }, // ts 文件
		{ language: 'markdown', scheme: 'file' }  // md 文件
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
