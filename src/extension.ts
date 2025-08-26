
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 装饰器类型定义
const linkableTextDecorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
    color: '#0066cc',
    cursor: 'pointer',
    fontWeight: 'bold'
});

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

// 跳转定义 - 包含定义和所有引用
class IniSectionDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        doc: vscode.TextDocument,
        pos: vscode.Position
    ): Promise<vscode.Definition> {
        const manager = ConfigSectionManager.getInstance();
        await manager.scanAllSections();
        
        const match = manager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return [];
        }

        const targetId = match.sectionId;
        
        // 1. 首先获取定义位置
        const defLocation = manager.getSectionLocation(targetId);
        if (!defLocation) {
            return [];
        }

        // 2. 收集所有引用位置
        const referenceLocations: vscode.Location[] = [];
        const uris = await vscode.workspace.findFiles('**/*.{ini,lua,txt,ts,md}');

        for (const uri of uris) {
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
                            const refLocation = new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length)));
                            
                            // 避免重复添加定义位置
                            if (!this.isSameLocation(refLocation, defLocation)) {
                                referenceLocations.push(refLocation);
                            }
                            offset = idxInLine + targetId.length;
                        }
                    }

                    // 2) .lua：双引号或单引号里的 id
                    if (uri.fsPath.endsWith('.lua')) {
                        const luaRegex = new RegExp(`(['"])${this.escapeRegex(targetId)}\\1`, 'g');
                        let match;
                        while ((match = luaRegex.exec(line)) !== null) {
                            const posStart = new vscode.Position(idx, match.index + 1); // +1 跳过引号
                            const refLocation = new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length)));
                            referenceLocations.push(refLocation);
                        }
                    }

                    // 3) .ts：双引号或单引号里的 id，类似 lua
                    if (uri.fsPath.endsWith('.ts')) {
                        const tsRegex = new RegExp(`(['"\`])${this.escapeRegex(targetId)}\\1`, 'g');
                        let match;
                        while ((match = tsRegex.exec(line)) !== null) {
                            const posStart = new vscode.Position(idx, match.index + 1); // +1 跳过引号
                            const refLocation = new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length)));
                            referenceLocations.push(refLocation);
                        }
                    }

                    // 4) .txt 和 .md：直接文本匹配
                    if (uri.fsPath.endsWith('.txt') || uri.fsPath.endsWith('.md')) {
                        let offset = 0;
                        let idxInLine = -1;
                        while ((idxInLine = line.indexOf(targetId, offset)) !== -1) {
                            const posStart = new vscode.Position(idx, idxInLine);
                            const refLocation = new vscode.Location(uri, new vscode.Range(posStart, posStart.translate(0, targetId.length)));
                            
                            // 避免重复添加定义位置
                            if (!this.isSameLocation(refLocation, defLocation)) {
                                referenceLocations.push(refLocation);
                            }
                            offset = idxInLine + targetId.length;
                        }
                    }
                });
            } catch {
                // 忽略无法读取的文件
            }
        }

        // 3. 始终显示选择面板，提供一致的用户体验
        this.showLocationPicker(defLocation, referenceLocations, targetId);
        
        // 返回空数组，让选择面板处理跳转
        return [];
    }

    public async showLocationPicker(defLocation: vscode.Location, referenceLocations: vscode.Location[], targetId: string) {
        const items: vscode.QuickPickItem[] = [];
        
        // 添加定义项（带特殊标识和内容预览）
        const defRelativePath = vscode.workspace.asRelativePath(defLocation.uri);
        const defPreview = await this.getDefinitionPreview(defLocation, targetId);
        items.push({
            label: `🎯 [${targetId}] 定义`,
            description: `${defRelativePath}:${defLocation.range.start.line + 1}`,
            detail: defPreview,
            picked: true // 默认选中定义
        });
        
        // 添加引用项（带上下文信息）
        for (let index = 0; index < referenceLocations.length; index++) {
            const refLoc = referenceLocations[index];
            const refFileName = path.basename(refLoc.uri.fsPath);
            const refRelativePath = vscode.workspace.asRelativePath(refLoc.uri);
            const fileType = refFileName.split('.').pop()?.toUpperCase() || '';
            const contextInfo = await this.getReferenceContext(refLoc, targetId);
            
            items.push({
                label: `📄 ${targetId}`,
                description: `${refRelativePath}:${refLoc.range.start.line + 1}`,
                detail: `${fileType} | ${contextInfo}`
            });
        }
        
        // 构建面板标题
        const totalCount = 1 + referenceLocations.length;
        const title = referenceLocations.length === 0 
            ? `跳转到配置项: ${targetId}` 
            : `选择跳转位置: ${targetId} (${totalCount}个位置)`;
        
        // 显示快速选择面板
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: title,
            matchOnDescription: true,
            matchOnDetail: true,
            canPickMany: false
        });
        
        if (selected) {
            // 根据选择跳转到对应位置
            if (selected.label.includes('定义')) {
                vscode.window.showTextDocument(defLocation.uri, {
                    selection: defLocation.range
                });
            } else {
                // 查找对应的引用位置
                const selectedIndex = items.indexOf(selected) - 1; // 减1因为定义在第一位
                if (selectedIndex >= 0 && selectedIndex < referenceLocations.length) {
                    const targetLoc = referenceLocations[selectedIndex];
                    vscode.window.showTextDocument(targetLoc.uri, {
                        selection: targetLoc.range
                    });
                }
            }
        }
    }

    public escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    public isSameLocation(loc1: vscode.Location, loc2: vscode.Location | undefined): boolean {
        if (!loc2) {
            return false;
        }
        return loc1.uri.fsPath === loc2.uri.fsPath && 
               loc1.range.start.line === loc2.range.start.line &&
               loc1.range.start.character === loc2.range.start.character;
    }

    // 获取定义的预览内容
    private async getDefinitionPreview(defLocation: vscode.Location, targetId: string): Promise<string> {
        try {
            const content = fs.readFileSync(defLocation.uri.fsPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const startLine = defLocation.range.start.line;
            
            const previewLines: string[] = [];
            let inside = false;
            let lineCount = 0;
            
            for (let i = startLine; i < lines.length && lineCount < 3; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                if (trimmed === `[${targetId}]`) {
                    inside = true;
                    continue; // 跳过节名本身
                }
                
                if (inside) {
                    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                        break; // 遇到下一个节，结束
                    }
                    if (trimmed !== '') {
                        previewLines.push(trimmed);
                        lineCount++;
                    }
                }
            }
            
            return previewLines.length > 0 
                ? `INI 定义: ${previewLines.join(' | ')}`
                : 'INI配置项定义位置';
        } catch {
            return 'INI配置项定义位置';
        }
    }

    // 获取引用的上下文信息
    private async getReferenceContext(refLocation: vscode.Location, targetId: string): Promise<string> {
        try {
            const content = fs.readFileSync(refLocation.uri.fsPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const targetLine = refLocation.range.start.line;
            
            // 获取目标行
            const currentLine = lines[targetLine] || '';
            const trimmedLine = currentLine.trim();
            
            // 如果当前行太长，截取中间部分
            if (trimmedLine.length > 60) {
                const targetPos = refLocation.range.start.character;
                const start = Math.max(0, targetPos - 20);
                const end = Math.min(currentLine.length, targetPos + targetId.length + 20);
                const excerpt = currentLine.substring(start, end);
                return `...${excerpt}...`;
            }
            
            // 如果行不长，直接返回
            if (trimmedLine.length > 0) {
                return trimmedLine;
            }
            
            // 如果当前行为空，尝试获取上下文
            const contextLines: string[] = [];
            for (let i = Math.max(0, targetLine - 1); i <= Math.min(lines.length - 1, targetLine + 1); i++) {
                const line = lines[i];
                if (line && line.trim()) {
                    contextLines.push(line.trim());
                }
            }
            
            return contextLines.length > 0 ? contextLines.join(' | ') : '引用位置';
        } catch {
            return '引用位置';
        }
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

// 装饰器提供者 - 高亮可链接的配置项
class IniSectionDecorationProvider {
    private manager: ConfigSectionManager;
    private timeout: NodeJS.Timeout | undefined;

    constructor() {
        this.manager = ConfigSectionManager.getInstance();
    }

    async updateDecorations(editor: vscode.TextEditor) {
        if (!editor) {
            return;
        }

        await this.manager.scanAllSections();
        const sectionIds = this.manager.getAllSectionIds();
        
        if (sectionIds.length === 0) {
            return;
        }

        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];

        // 按长度降序排序，优先匹配更长的配置项
        sectionIds.sort((a, b) => b.length - a.length);
        const processedRanges = new Set<string>(); // 用于避免重叠匹配

        for (const sectionId of sectionIds) {
            const lines = text.split(/\r?\n/);
            
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const trimmed = line.trim();
                
                // 跳过INI文件中的节定义行
                if (editor.document.fileName.endsWith('.ini') && trimmed.startsWith('[')) {
                    continue;
                }

                let searchIndex = 0;
                let foundIndex = -1;

                while ((foundIndex = line.indexOf(sectionId, searchIndex)) !== -1) {
                    const startPos = new vscode.Position(lineIndex, foundIndex);
                    const endPos = new vscode.Position(lineIndex, foundIndex + sectionId.length);
                    const range = new vscode.Range(startPos, endPos);
                    const rangeKey = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
                    
                    // 检查是否与已处理的范围重叠
                    if (!processedRanges.has(rangeKey)) {
                        // 根据文件类型进行不同的匹配策略
                        let shouldDecorate = false;
                        
                        if (editor.document.fileName.endsWith('.lua')) {
                            // Lua文件：检查是否在引号内
                            const beforeChar = foundIndex > 0 ? line[foundIndex - 1] : '';
                            const afterChar = foundIndex + sectionId.length < line.length ? line[foundIndex + sectionId.length] : '';
                            shouldDecorate = (beforeChar === '"' || beforeChar === "'") && 
                                           (afterChar === '"' || afterChar === "'");
                        } else if (editor.document.fileName.endsWith('.ts')) {
                            // TypeScript文件：检查是否在引号内
                            const beforeChar = foundIndex > 0 ? line[foundIndex - 1] : '';
                            const afterChar = foundIndex + sectionId.length < line.length ? line[foundIndex + sectionId.length] : '';
                            shouldDecorate = (beforeChar === '"' || beforeChar === "'" || beforeChar === '`') && 
                                           (afterChar === '"' || afterChar === "'" || afterChar === '`');
                        } else if (editor.document.fileName.endsWith('.ini')) {
                            // INI文件：行内引用（非节定义）
                            shouldDecorate = !trimmed.startsWith('[');
                        } else {
                            // txt, md等其他文件：直接匹配
                            shouldDecorate = true;
                        }

                        if (shouldDecorate) {
                            // 创建包含命令链接的 MarkdownString
                            const hoverMarkdown = new vscode.MarkdownString();
                            hoverMarkdown.isTrusted = true;
                            hoverMarkdown.supportHtml = true;
                            
                            // 构建命令URI
                            const commandUri = vscode.Uri.parse(`command:w3x-ini-support.goToDefinition?${encodeURIComponent(JSON.stringify({
                                sectionId: sectionId,
                                sourceUri: editor.document.uri.toString(),
                                position: { line: lineIndex, character: foundIndex }
                            }))}`);
                            
                            hoverMarkdown.appendMarkdown(`🎯 [跳转到配置项: \`[${sectionId}]\`](${commandUri})`);
                            
                            decorations.push({
                                range,
                                hoverMessage: hoverMarkdown
                            });
                            processedRanges.add(rangeKey);
                        }
                    }
                    
                    searchIndex = foundIndex + 1;
                }
            }
        }

        editor.setDecorations(linkableTextDecorationType, decorations);
    }

    triggerUpdateDecorations(editor: vscode.TextEditor) {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        this.timeout = setTimeout(() => this.updateDecorations(editor), 100);
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

	// 创建装饰器提供者
	const decorationProvider = new IniSectionDecorationProvider();

	// 注册自定义命令：从装饰器跳转到定义
	const goToDefinitionCommand = vscode.commands.registerCommand(
		'w3x-ini-support.goToDefinition',
		async (args: { sectionId: string, sourceUri: string, position: { line: number, character: number } }) => {
			const manager = ConfigSectionManager.getInstance();
			await manager.scanAllSections();
			
			const defLocation = manager.getSectionLocation(args.sectionId);
			if (defLocation) {
				// 创建一个临时的定义提供者实例来重用逻辑
				const tempProvider = new IniSectionDefinitionProvider();
				
				// 模拟一个文档和位置来调用现有方法
				const sourceDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.sourceUri));
				const position = new vscode.Position(args.position.line, args.position.character);
				
				// 调用现有的 provideDefinition 方法
				await tempProvider.provideDefinition(sourceDoc, position);
			}
		}
	);
	context.subscriptions.push(goToDefinitionCommand);

	// 新增 GoTo Definition（包含定义和引用）
    const defProvider = vscode.languages.registerDefinitionProvider(
        iniLuaSelector,
        new IniSectionDefinitionProvider()
    );
    context.subscriptions.push(defProvider);

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

	// 注册装饰器事件
	const updateDecorations = (editor: vscode.TextEditor | undefined) => {
		if (editor && isRelevantFile(editor.document.fileName)) {
			decorationProvider.triggerUpdateDecorations(editor);
		}
	};

	// 检查文件是否相关
	const isRelevantFile = (fileName: string): boolean => {
		return fileName.endsWith('.ini') || fileName.endsWith('.lua') || 
		       fileName.endsWith('.txt') || fileName.endsWith('.ts') || 
		       fileName.endsWith('.md');
	};

	// 监听编辑器变化
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			updateDecorations(editor);
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (vscode.window.activeTextEditor && 
				event.document === vscode.window.activeTextEditor.document &&
				isRelevantFile(event.document.fileName)) {
				decorationProvider.triggerUpdateDecorations(vscode.window.activeTextEditor);
			}
		}),
		vscode.workspace.onDidSaveTextDocument(document => {
			if (document.fileName.endsWith('.ini')) {
				// INI文件保存时，清除缓存并更新所有打开的编辑器
				const manager = ConfigSectionManager.getInstance();
				manager['lastScanTime'] = 0; // 强制重新扫描
				
				vscode.window.visibleTextEditors.forEach(editor => {
					if (isRelevantFile(editor.document.fileName)) {
						decorationProvider.triggerUpdateDecorations(editor);
					}
				});
			}
		})
	);

}

// This method is called when your extension is deactivated
export function deactivate() {
	// 清理装饰器
	if (linkableTextDecorationType) {
		linkableTextDecorationType.dispose();
	}
}
