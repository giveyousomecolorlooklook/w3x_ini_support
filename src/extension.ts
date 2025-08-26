
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

// 文件分词信息缓存管理器
class FileTokenManager {
    private static instance: FileTokenManager;
    private fileTokenCache: Map<string, Map<string, vscode.Range[]>> = new Map(); // 文件路径 -> 配置项ID -> 位置列表
    private fileHashCache: Map<string, string> = new Map(); // 文件hash缓存
    private configManager: ConfigSectionManager;
    
    static getInstance(): FileTokenManager {
        if (!FileTokenManager.instance) {
            FileTokenManager.instance = new FileTokenManager();
        }
        return FileTokenManager.instance;
    }

    constructor() {
        this.configManager = ConfigSectionManager.getInstance();
    }

    // 计算文件内容hash
    private getFileHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 检查文件是否相关
    private isRelevantFile(filePath: string): boolean {
        return filePath.endsWith('.ini') || filePath.endsWith('.lua') || 
               filePath.endsWith('.txt') || filePath.endsWith('.ts') || 
               filePath.endsWith('.md');
    }

    // 扫描单个文件的分词信息
    private scanFileTokens(uri: vscode.Uri): boolean {
        if (!this.isRelevantFile(uri.fsPath)) {
            return false;
        }

        try {
            const content = fs.readFileSync(uri.fsPath, 'utf8');
            const newHash = this.getFileHash(content);
            const oldHash = this.fileHashCache.get(uri.fsPath);
            
            // 文件内容未变化，跳过
            if (oldHash === newHash) {
                return false;
            }
            
            console.log(`INI Config Navigator: 检测到文件变化，更新分词缓存 - ${path.basename(uri.fsPath)}`);
            
            // 获取所有配置项
            const sectionIds = this.configManager.getAllSectionIds();
            if (sectionIds.length === 0) {
                return false;
            }
            
            // 清除该文件的旧分词信息
            this.fileTokenCache.delete(uri.fsPath);
            
            const lines = content.split(/\r?\n/);
            const tokenMap = new Map<string, vscode.Range[]>();
            
            // 按长度降序排序，优先匹配更长的配置项
            sectionIds.sort((a, b) => b.length - a.length);
            
            let totalMatches = 0;
            
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const line = lines[lineIndex];
                const trimmed = line.trim();
                
                // 跳过INI文件中的节定义行
                if (uri.fsPath.endsWith('.ini') && trimmed.startsWith('[')) {
                    continue;
                }
                
                for (const sectionId of sectionIds) {
                    let searchIndex = 0;
                    let foundIndex = -1;
                    
                    while ((foundIndex = line.indexOf(sectionId, searchIndex)) !== -1) {
                        // 根据文件类型进行不同的匹配策略
                        let shouldMatch = false;
                        
                        if (uri.fsPath.endsWith('.lua')) {
                            // Lua文件：检查是否在引号内
                            const beforeChar = foundIndex > 0 ? line[foundIndex - 1] : '';
                            const afterChar = foundIndex + sectionId.length < line.length ? line[foundIndex + sectionId.length] : '';
                            shouldMatch = (beforeChar === '"' || beforeChar === "'") && 
                                         (afterChar === '"' || afterChar === "'");
                        } else if (uri.fsPath.endsWith('.ts')) {
                            // TypeScript文件：检查是否在引号内
                            const beforeChar = foundIndex > 0 ? line[foundIndex - 1] : '';
                            const afterChar = foundIndex + sectionId.length < line.length ? line[foundIndex + sectionId.length] : '';
                            shouldMatch = (beforeChar === '"' || beforeChar === "'" || beforeChar === '`') && 
                                         (afterChar === '"' || afterChar === "'" || afterChar === '`');
                        } else if (uri.fsPath.endsWith('.ini')) {
                            // INI文件：行内引用（非节定义）
                            shouldMatch = !trimmed.startsWith('[');
                        } else {
                            // txt, md等其他文件：直接匹配
                            shouldMatch = true;
                        }
                        
                        if (shouldMatch) {
                            const range = new vscode.Range(
                                new vscode.Position(lineIndex, foundIndex),
                                new vscode.Position(lineIndex, foundIndex + sectionId.length)
                            );
                            
                            if (!tokenMap.has(sectionId)) {
                                tokenMap.set(sectionId, []);
                            }
                            tokenMap.get(sectionId)!.push(range);
                            totalMatches++;
                        }
                        
                        searchIndex = foundIndex + 1;
                    }
                }
            }
            
            // 保存分词信息
            this.fileTokenCache.set(uri.fsPath, tokenMap);
            this.fileHashCache.set(uri.fsPath, newHash);
            
            console.log(`INI Config Navigator: 文件 ${path.basename(uri.fsPath)} 找到 ${totalMatches} 个配置项引用`);
            return true;
            
        } catch (error) {
            console.error(`INI Config Navigator: 扫描文件分词失败 - ${uri.fsPath}:`, error);
            return false;
        }
    }

    // 扫描工作区所有相关文件（配置项缓存更新后调用）
    async scanAllFiles(): Promise<void> {
        console.log('INI Config Navigator: 开始扫描工作区文件分词信息...');
        
        try {
            const patterns = ['**/*.ini', '**/*.lua', '**/*.txt', '**/*.ts', '**/*.md'];
            let totalFiles = 0;
            let changedFiles = 0;
            
            for (const pattern of patterns) {
                const uris = await vscode.workspace.findFiles(pattern);
                for (const uri of uris) {
                    totalFiles++;
                    if (this.scanFileTokens(uri)) {
                        changedFiles++;
                    }
                }
            }
            
            console.log(`INI Config Navigator: 文件分词扫描完成，总计 ${totalFiles} 个文件，更新 ${changedFiles} 个文件`);
        } catch (error) {
            console.error('INI Config Navigator: 扫描工作区文件失败:', error);
        }
    }

    // 单个文件变化时的增量更新
    async updateFile(uri: vscode.Uri): Promise<boolean> {
        return this.scanFileTokens(uri);
    }

    // 配置项缓存更新后，只重新扫描缓存过的文件
    async onConfigCacheUpdated(): Promise<void> {
        console.log('INI Config Navigator: 配置项缓存更新，重新扫描已缓存的文件...');
        
        // 获取所有已缓存的文件路径
        const cachedFiles = Array.from(this.fileTokenCache.keys());
        
        // 清空分词缓存，但保留文件hash缓存以支持增量更新
        this.fileTokenCache.clear();
        
        let updatedFiles = 0;
        for (const filePath of cachedFiles) {
            try {
                const uri = vscode.Uri.file(filePath);
                if (this.scanFileTokens(uri)) {
                    updatedFiles++;
                }
            } catch (error) {
                console.error(`INI Config Navigator: 重新扫描文件失败 - ${filePath}:`, error);
            }
        }
        
        console.log(`INI Config Navigator: 重新扫描完成，更新了 ${updatedFiles} 个文件的分词信息`);
    }

    // 获取文件中的配置项引用（从缓存）
    getFileTokens(filePath: string): Map<string, vscode.Range[]> | undefined {
        return this.fileTokenCache.get(filePath);
    }

    // 获取特定配置项在文件中的位置（从缓存）
    getTokenRanges(filePath: string, sectionId: string): vscode.Range[] {
        const fileTokens = this.fileTokenCache.get(filePath);
        return fileTokens?.get(sectionId) || [];
    }

    // 清理特定文件的缓存
    clearFileCache(filePath: string): void {
        this.fileTokenCache.delete(filePath);
        this.fileHashCache.delete(filePath);
    }

    // 清理所有缓存
    dispose(): void {
        this.fileTokenCache.clear();
        this.fileHashCache.clear();
    }
}

// 配置项信息管理器 - 只管理INI文件中的配置项定义
class ConfigSectionManager {
    private static instance: ConfigSectionManager;
    private sectionCache: Map<string, { location: vscode.Location, content: string[] }> = new Map(); // 配置项ID -> {位置, 内容}
    private fileHashCache: Map<string, string> = new Map(); // INI文件hash缓存
    
    static getInstance(): ConfigSectionManager {
        if (!ConfigSectionManager.instance) {
            ConfigSectionManager.instance = new ConfigSectionManager();
        }
        return ConfigSectionManager.instance;
    }

    // 计算文件内容hash
    private getFileHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return hash.toString();
    }

    // 扫描单个INI文件的配置项
    private scanIniFile(uri: vscode.Uri): boolean {
        try {
            const content = fs.readFileSync(uri.fsPath, 'utf8');
            const newHash = this.getFileHash(content);
            const oldHash = this.fileHashCache.get(uri.fsPath);
            
            // 文件内容未变化，跳过
            if (oldHash === newHash) {
                return false;
            }
            
            console.log(`INI Config Navigator: 检测到INI文件变化，更新缓存 - ${path.basename(uri.fsPath)}`);
            
            // 清除该文件的旧配置项
            for (const [sectionId, sectionInfo] of this.sectionCache.entries()) {
                if (sectionInfo.location.uri.fsPath === uri.fsPath) {
                    this.sectionCache.delete(sectionId);
                }
            }
            
            // 扫描新的配置项
            const lines = content.split(/\r?\n/);
            let addedCount = 0;
            
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/^\[(.+?)\]$/);
                if (match) {
                    const sectionId = match[1];
                    const location = new vscode.Location(uri, new vscode.Range(i, 0, i, 0));
                    
                    // 读取配置项内容
                    const sectionContent: string[] = [];
                    for (let j = i + 1; j < lines.length; j++) {
                        const line = lines[j];
                        const trimmed = line.trim();
                        
                        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                            break;
                        }
                        if (trimmed !== '') {
                            sectionContent.push(line);
                        }
                    }
                    
                    this.sectionCache.set(sectionId, { location, content: sectionContent });
                    addedCount++;
                }
            }
            
            // 更新文件hash
            this.fileHashCache.set(uri.fsPath, newHash);
            console.log(`INI Config Navigator: 文件 ${path.basename(uri.fsPath)} 新增/更新 ${addedCount} 个配置项`);
            
            return true;
        } catch (error) {
            console.error(`INI Config Navigator: 读取INI文件失败 - ${uri.fsPath}:`, error);
            return false;
        }
    }

    // 扫描所有INI文件（初始化时调用）
    async scanAllSections(): Promise<boolean> {
        console.log('INI Config Navigator: 开始扫描所有INI文件...');
        
        try {
            const uris = await vscode.workspace.findFiles('**/*.ini');
            let hasChanges = false;
            
            for (const uri of uris) {
                if (this.scanIniFile(uri)) {
                    hasChanges = true;
                }
            }
            
            console.log(`INI Config Navigator: 扫描完成，总共 ${this.sectionCache.size} 个配置项`);
            return hasChanges;
        } catch (error) {
            console.error('INI Config Navigator: 扫描INI文件失败:', error);
            return false;
        }
    }

    // INI文件变化时的增量更新
    async updateIniFile(uri: vscode.Uri): Promise<boolean> {
        return this.scanIniFile(uri);
    }

    // 获取所有配置项ID（从缓存）
    getAllSectionIds(): string[] {
        return Array.from(this.sectionCache.keys());
    }

    // 获取配置项定义位置（从缓存）
    getSectionLocation(sectionId: string): vscode.Location | undefined {
        const sectionInfo = this.sectionCache.get(sectionId);
        return sectionInfo?.location;
    }

    // 获取配置项内容（从缓存）
    getSectionContent(sectionId: string): string[] | undefined {
        const sectionInfo = this.sectionCache.get(sectionId);
        return sectionInfo?.content;
    }

    // 在指定位置查找匹配的配置项（从缓存）
    findMatchingSectionAtPosition(doc: vscode.TextDocument, pos: vscode.Position): { sectionId: string, range: vscode.Range } | null {
        const line = doc.lineAt(pos.line).text;
        const sectionIds = this.getAllSectionIds();
        
        // 按长度降序排序，优先匹配更长的配置项
        sectionIds.sort((a, b) => b.length - a.length);
        
        for (const sectionId of sectionIds) {
            let searchIndex = 0;
            let foundIndex = -1;
            
            while ((foundIndex = line.indexOf(sectionId, searchIndex)) !== -1) {
                const startPos = new vscode.Position(pos.line, foundIndex);
                const endPos = new vscode.Position(pos.line, foundIndex + sectionId.length);
                const range = new vscode.Range(startPos, endPos);
                
                if (range.contains(pos)) {
                    return { sectionId, range };
                }
                
                searchIndex = foundIndex + 1;
            }
        }
        
        return null;
    }

    // 清理缓存（扩展卸载时调用）
    dispose(): void {
        this.sectionCache.clear();
        this.fileHashCache.clear();
    }
}

// 跳转定义 - 只从缓存读取数据
class IniSectionDefinitionProvider implements vscode.DefinitionProvider {
    private configManager: ConfigSectionManager;
    private tokenManager: FileTokenManager;

    constructor() {
        this.configManager = ConfigSectionManager.getInstance();
        this.tokenManager = FileTokenManager.getInstance();
    }

    async provideDefinition(
        doc: vscode.TextDocument,
        pos: vscode.Position
    ): Promise<vscode.Definition> {
        // 直接从缓存查找匹配的配置项
        const match = this.configManager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return [];
        }

        const targetId = match.sectionId;
        
        // 从缓存获取定义位置
        const defLocation = this.configManager.getSectionLocation(targetId);
        if (!defLocation) {
            return [];
        }

        // 从缓存收集所有引用位置
        const referenceLocations: vscode.Location[] = [];
        
        // 遍历所有已缓存的文件分词信息
        for (const [filePath, tokenMap] of this.tokenManager['fileTokenCache']) {
            const ranges = tokenMap.get(targetId);
            if (ranges && ranges.length > 0) {
                const uri = vscode.Uri.file(filePath);
                for (const range of ranges) {
                    const refLocation = new vscode.Location(uri, range);
                    
                    // 避免重复添加定义位置
                    if (!this.isSameLocation(refLocation, defLocation)) {
                        referenceLocations.push(refLocation);
                    }
                }
            }
        }

        // 显示选择面板
        this.showLocationPicker(defLocation, referenceLocations, targetId);
        
        return [];
    }

    public async showLocationPicker(defLocation: vscode.Location, referenceLocations: vscode.Location[], targetId: string) {
        const items: vscode.QuickPickItem[] = [];
        
        // 添加定义项
        const defRelativePath = vscode.workspace.asRelativePath(defLocation.uri);
        const defPreview = await this.getDefinitionPreview(defLocation, targetId);
        items.push({
            label: `🎯 [${targetId}] 定义`,
            description: `${defRelativePath}:${defLocation.range.start.line + 1}`,
            detail: defPreview,
            picked: true
        });
        
        // 添加引用项
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
            if (selected.label.includes('定义')) {
                vscode.window.showTextDocument(defLocation.uri, {
                    selection: defLocation.range
                });
            } else {
                const selectedIndex = items.indexOf(selected) - 1;
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

    // 获取定义的预览内容（从缓存的定义位置读取）
    private async getDefinitionPreview(defLocation: vscode.Location, targetId: string): Promise<string> {
        // 优先使用缓存的配置项内容
        const sectionContent = this.configManager.getSectionContent(targetId);
        if (sectionContent && sectionContent.length > 0) {
            const previewLines = sectionContent.slice(0, 3); // 取前3行
            return `INI 定义: ${previewLines.map(line => line.trim()).filter(line => line).join(' | ')}`;
        }
        
        // 降级到文件读取
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
                    continue;
                }
                
                if (inside) {
                    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                        break;
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
            
            const currentLine = lines[targetLine] || '';
            const trimmedLine = currentLine.trim();
            
            if (trimmedLine.length > 60) {
                const targetPos = refLocation.range.start.character;
                const start = Math.max(0, targetPos - 20);
                const end = Math.min(currentLine.length, targetPos + targetId.length + 20);
                const excerpt = currentLine.substring(start, end);
                return `...${excerpt}...`;
            }
            
            if (trimmedLine.length > 0) {
                return trimmedLine;
            }
            
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
// 鼠标悬停 - 只从缓存读取数据，大文件局部优化
class IniSectionHoverProvider implements vscode.HoverProvider {
    private configManager: ConfigSectionManager;

    constructor() {
        this.configManager = ConfigSectionManager.getInstance();
    }

    async provideHover(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        // 直接从缓存查找匹配的配置项
        const match = this.configManager.findMatchingSectionAtPosition(doc, pos);
        if (!match) {
            return;
        }

        const targetId = match.sectionId;
        const defLocation = this.configManager.getSectionLocation(targetId);
        const sectionContent = this.configManager.getSectionContent(targetId);
        
        if (!defLocation) {
            return;
        }

        try {
            const contentLines: string[] = [`[${targetId}]`];
            
            // 优先使用缓存的内容
            if (sectionContent && sectionContent.length > 0) {
                contentLines.push(...sectionContent);
            } else {
                // 缓存中没有内容，从文件读取（降级处理）
                const content = fs.readFileSync(defLocation.uri.fsPath, 'utf8');
                const lines = content.split(/\r?\n/);
                const startLine = defLocation.range.start.line;
                
                let inside = false;
                
                for (let i = startLine; i < lines.length; i++) {
                    const line = lines[i];
                    const trimmed = line.trim();
                    
                    if (trimmed === `[${targetId}]`) {
                        inside = true;
                        continue;
                    }
                    
                    if (inside) {
                        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                            break;
                        }
                        contentLines.push(line);
                    }
                }
            }
            
            if (contentLines.length > 1) {
                const md = new vscode.MarkdownString();
                md.appendCodeblock(contentLines.join('\n'), 'ini');
                return new vscode.Hover(md, match.range);
            }
        } catch {
            // 忽略文件读取错误
        }
        
        // 降级到简单显示
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**INI配置项**: \`[${targetId}]\``);
        return new vscode.Hover(md, match.range);
    }
}

// 装饰器提供者 - 实现局部渲染优化
class IniSectionDecorationProvider {
    private tokenManager: FileTokenManager;
    private timeout: NodeJS.Timeout | undefined;
    private fileDecorationCache: Map<string, vscode.DecorationOptions[]> = new Map(); // 文件装饰缓存

    constructor() {
        this.tokenManager = FileTokenManager.getInstance();
    }

    // 获取可见区域范围（大文件优化）
    private getVisibleRange(editor: vscode.TextEditor): vscode.Range {
        const visibleRanges = editor.visibleRanges;
        if (visibleRanges.length === 0) {
            return new vscode.Range(0, 0, Math.min(editor.document.lineCount - 1, 500), 0);
        }
        
        // 扩展可见范围前后各500行（大文件优化）
        const firstVisible = visibleRanges[0];
        const lastVisible = visibleRanges[visibleRanges.length - 1];
        
        const startLine = Math.max(0, firstVisible.start.line - 500);
        const endLine = Math.min(editor.document.lineCount - 1, lastVisible.end.line + 500);
        
        return new vscode.Range(startLine, 0, endLine, 0);
    }

    // 判断是否为大文件
    private isLargeFile(editor: vscode.TextEditor): boolean {
        return editor.document.lineCount > 1000;
    }

    async updateDecorations(editor: vscode.TextEditor) {
        if (!editor) {
            return;
        }

        const filePath = editor.document.uri.fsPath;
        
        // 从缓存获取该文件的分词信息
        const fileTokens = this.tokenManager.getFileTokens(filePath);
        if (!fileTokens || fileTokens.size === 0) {
            // 没有缓存数据，清空装饰
            editor.setDecorations(linkableTextDecorationType, []);
            this.fileDecorationCache.delete(filePath);
            console.log(`INI Config Navigator: 文件 ${path.basename(filePath)} - 无缓存分词信息，清空装饰`);
            return;
        }

        const isLarge = this.isLargeFile(editor);
        const renderRange = isLarge ? this.getVisibleRange(editor) : undefined;
        
        const decorations: vscode.DecorationOptions[] = [];
        let totalMatches = 0;
        let renderedMatches = 0;
        
        // 遍历所有配置项的匹配位置
        for (const [sectionId, ranges] of fileTokens) {
            for (const range of ranges) {
                totalMatches++;
                
                // 大文件只渲染可见区域附近的装饰
                if (isLarge && renderRange && !renderRange.intersection(range)) {
                    continue;
                }
                
                renderedMatches++;
                
                // 创建包含命令链接的 MarkdownString
                const hoverMarkdown = new vscode.MarkdownString();
                hoverMarkdown.isTrusted = true;
                hoverMarkdown.supportHtml = true;
                
                // 构建命令URI
                const commandUri = vscode.Uri.parse(`command:w3x-ini-support.goToDefinition?${encodeURIComponent(JSON.stringify({
                    sectionId: sectionId,
                    sourceUri: editor.document.uri.toString(),
                    position: { line: range.start.line, character: range.start.character }
                }))}`);
                
                hoverMarkdown.appendMarkdown(`🎯 [跳转到配置项: \`[${sectionId}]\`](${commandUri})`);
                
                const decoration = {
                    range,
                    hoverMessage: hoverMarkdown
                };
                
                decorations.push(decoration);
            }
        }

        // 应用装饰
        editor.setDecorations(linkableTextDecorationType, decorations);
        
        // 缓存装饰信息
        this.fileDecorationCache.set(filePath, decorations);
        
        const renderInfo = isLarge 
            ? `局部渲染 ${renderedMatches}/${totalMatches} 个装饰（大文件优化）`
            : `新增装饰 ${renderedMatches} 个`;
        
        console.log(`INI Config Navigator: 文件 ${path.basename(filePath)} - ${renderInfo}`);
    }

    triggerUpdateDecorations(editor: vscode.TextEditor) {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        this.timeout = setTimeout(() => this.updateDecorations(editor), 100); // 减少延迟，因为是从缓存读取
    }

    // 清理文件装饰缓存
    clearFileDecorationCache(filePath: string): void {
        this.fileDecorationCache.delete(filePath);
    }

    // 清理所有装饰缓存
    dispose(): void {
        this.fileDecorationCache.clear();
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
    }
}

// 补全 - 只从缓存读取数据
class IniSectionCompletionProvider implements vscode.CompletionItemProvider {
    private configManager: ConfigSectionManager;

    constructor() {
        this.configManager = ConfigSectionManager.getInstance();
    }

    async provideCompletionItems(
        doc: vscode.TextDocument,
        pos: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        // 直接从缓存获取配置项
        const sectionIds = this.configManager.getAllSectionIds();
        const items: vscode.CompletionItem[] = [];
        
        for (const sectionId of sectionIds) {
            if (token.isCancellationRequested) {
                break;
            }
            
            const item = new vscode.CompletionItem(sectionId, vscode.CompletionItemKind.Reference);
            
            // 从缓存获取节的详细内容
            const sectionContent = this.configManager.getSectionContent(sectionId);
            if (sectionContent && sectionContent.length > 0) {
                item.documentation = new vscode.MarkdownString('```ini\n[' + sectionId + ']\n' + sectionContent.join('\n') + '\n```');
                item.documentation.isTrusted = true;
            }
            
            // 设置插入范围
            const line = doc.lineAt(pos.line).text;
            let start = pos.character;
            let end = pos.character;
            
            while (start > 0 && /[\w\d]/.test(line[start - 1])) {
                start--;
            }
            
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
	
	// 初始化管理器
	const configManager = ConfigSectionManager.getInstance();
	const tokenManager = FileTokenManager.getInstance();
	const decorationProvider = new IniSectionDecorationProvider();

	// 语言选择器
	const iniLuaSelector = [
		{ language: 'ini', scheme: 'file' },
		{ language: 'lua', scheme: 'file' },
		{ language: 'plaintext', scheme: 'file' },
		{ language: 'typescript', scheme: 'file' },
		{ language: 'markdown', scheme: 'file' }
	];

	// 初始化缓存
	const initializeCaches = async () => {
		console.log('INI Config Navigator: 初始化缓存系统...');
		const configChanged = await configManager.scanAllSections();
		if (configChanged || configManager.getAllSectionIds().length > 0) {
			await tokenManager.scanAllFiles();
			
			// 更新当前激活编辑器的装饰
			if (vscode.window.activeTextEditor && isRelevantFile(vscode.window.activeTextEditor.document.fileName)) {
				decorationProvider.triggerUpdateDecorations(vscode.window.activeTextEditor);
			}
		}
	};

	// 立即初始化
	initializeCaches();

	// 注册自定义命令：从装饰器跳转到定义
	const goToDefinitionCommand = vscode.commands.registerCommand(
		'w3x-ini-support.goToDefinition',
		async (args: { sectionId: string, sourceUri: string, position: { line: number, character: number } }) => {
			const defLocation = configManager.getSectionLocation(args.sectionId);
			if (defLocation) {
				const tempProvider = new IniSectionDefinitionProvider();
				const sourceDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(args.sourceUri));
				const position = new vscode.Position(args.position.line, args.position.character);
				await tempProvider.provideDefinition(sourceDoc, position);
			}
		}
	);
	context.subscriptions.push(goToDefinitionCommand);

	// 注册语言功能提供者
	const defProvider = vscode.languages.registerDefinitionProvider(iniLuaSelector, new IniSectionDefinitionProvider());
	const hoverProvider = vscode.languages.registerHoverProvider(iniLuaSelector, new IniSectionHoverProvider());
	const completionProvider = vscode.languages.registerCompletionItemProvider(iniLuaSelector, new IniSectionCompletionProvider(), ".", "\"", ",", "'");
	
	context.subscriptions.push(defProvider, hoverProvider, completionProvider);

	// 检查文件是否相关
	const isRelevantFile = (fileName: string): boolean => {
		return fileName.endsWith('.ini') || fileName.endsWith('.lua') || 
		       fileName.endsWith('.txt') || fileName.endsWith('.ts') || 
		       fileName.endsWith('.md');
	};

	// 更新装饰器
	const updateDecorations = (editor: vscode.TextEditor | undefined) => {
		if (editor && isRelevantFile(editor.document.fileName)) {
			decorationProvider.triggerUpdateDecorations(editor);
		}
	};

	// 监听编辑器变化
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(
		// 切换编辑器时更新装饰
		vscode.window.onDidChangeActiveTextEditor(editor => {
			updateDecorations(editor);
		}),
		
		// 文档内容变化时的增量更新
		vscode.workspace.onDidChangeTextDocument(async event => {
			const filePath = event.document.uri.fsPath;
			
			if (filePath.endsWith('.ini')) {
				// INI文件变化：更新配置项缓存
				console.log(`INI Config Navigator: INI文件变化 - ${path.basename(filePath)}`);
				const configChanged = await configManager.updateIniFile(event.document.uri);
				
				if (configChanged) {
					// 配置项有变化，重新扫描所有文件的分词信息
					await tokenManager.onConfigCacheUpdated();
					
					// 更新所有打开的编辑器装饰
					vscode.window.visibleTextEditors.forEach(editor => {
						if (isRelevantFile(editor.document.fileName)) {
							decorationProvider.triggerUpdateDecorations(editor);
						}
					});
				}
			} else if (isRelevantFile(filePath)) {
				// 其他相关文件变化：更新该文件的分词信息
				const tokenChanged = await tokenManager.updateFile(event.document.uri);
				
				if (tokenChanged && vscode.window.activeTextEditor && 
					vscode.window.activeTextEditor.document.uri.fsPath === filePath) {
					// 该文件的分词信息有变化且是当前激活文件，更新装饰
					decorationProvider.triggerUpdateDecorations(vscode.window.activeTextEditor);
				}
			}
		}),
		
		// 文件关闭时清理缓存
		vscode.workspace.onDidCloseTextDocument(document => {
			const filePath = document.uri.fsPath;
			if (isRelevantFile(filePath)) {
				tokenManager.clearFileCache(filePath);
				decorationProvider.clearFileDecorationCache(filePath);
				console.log(`INI Config Navigator: 清理文件缓存 - ${path.basename(filePath)}`);
			}
		}),
		
		// 文件保存时的额外处理
		vscode.workspace.onDidSaveTextDocument(async document => {
			const filePath = document.uri.fsPath;
			
			if (filePath.endsWith('.ini')) {
				// INI文件保存：强制更新缓存
				console.log(`INI Config Navigator: INI文件保存 - ${path.basename(filePath)}`);
				const configChanged = await configManager.updateIniFile(document.uri);
				
				if (configChanged) {
					await tokenManager.onConfigCacheUpdated();
					
					// 延迟更新装饰器，确保缓存更新完成
					setTimeout(() => {
						vscode.window.visibleTextEditors.forEach(editor => {
							if (isRelevantFile(editor.document.fileName)) {
								decorationProvider.triggerUpdateDecorations(editor);
							}
						});
					}, 200);
				}
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
	
	// 清理缓存
	ConfigSectionManager.getInstance().dispose();
	FileTokenManager.getInstance().dispose();
	
	console.log('INI Config Navigator: 扩展已卸载，缓存已清理');
}
