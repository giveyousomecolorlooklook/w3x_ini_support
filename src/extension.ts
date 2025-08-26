
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// 装饰更新管理器 - 负责在编辑器激活时更新装饰
class DecorationUpdateManager {
	private static instance: DecorationUpdateManager;
	private decorationProvider: IniSectionDecorationProvider | null = null;

	static getInstance(): DecorationUpdateManager {
		if (!DecorationUpdateManager.instance) {
			DecorationUpdateManager.instance = new DecorationUpdateManager();
		}
		return DecorationUpdateManager.instance;
	}

	// 设置装饰提供器
	setDecorationProvider(provider: IniSectionDecorationProvider): void {
		this.decorationProvider = provider;
	}

	// 为当前激活的编辑器更新装饰
	async updateActiveEditor(editor: vscode.TextEditor): Promise<void> {
		if (!this.decorationProvider || !editor) {
			return;
		}

		const cacheManager = CacheRefreshManager.getInstance();
		
		// 如果正在刷新缓存，直接跳过更新
		if (cacheManager.isRefreshingCaches()) {
			console.log('INI Config Navigator: 缓存刷新中，跳过装饰更新');
			return;
		}

		const fileName = path.basename(editor.document.fileName);
		const filePath = editor.document.uri.fsPath;
		
		console.log(`INI Config Navigator: 更新激活编辑器装饰 - ${fileName}`);
		
		// 确保有缓存，如果没有则构建
		const tokenManager = FileTokenManager.getInstance();
		const fileTokens = tokenManager.getFileTokens(filePath);
		
		if (!fileTokens || fileTokens.size === 0) {
			console.log(`INI Config Navigator: 激活时无缓存，主动构建 - ${fileName}`);
			await tokenManager.updateFileTokens(filePath);
		}
		
		// 立即应用装饰
		await this.decorationProvider.updateDecorations(editor);
		console.log(`INI Config Navigator: 激活编辑器装饰更新完成 - ${fileName}`);
	}

	// 清理资源
	dispose(): void {
		this.decorationProvider = null;
	}
}

// 缓存刷新管理器 - 管理异步缓存刷新、装饰更新的状态协调
const linkableTextDecorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: 'underline',
    color: '#0066cc',
    cursor: 'pointer',
    fontWeight: 'bold'
});

// 缓存刷新管理器 - 管理异步缓存刷新和进度显示
class CacheRefreshManager {
    private static instance: CacheRefreshManager;
    private isRefreshing: boolean = false;
    private refreshQueue: Set<string> = new Set(); // 待刷新的文件队列
    private refreshPromise: Promise<void> | null = null; // 当前刷新操作的 Promise
    private isDecorationUpdating: boolean = false;
    private decorationPromise: Promise<void> | null = null; // 当前装饰更新的 Promise

    static getInstance(): CacheRefreshManager {
        if (!CacheRefreshManager.instance) {
            CacheRefreshManager.instance = new CacheRefreshManager();
        }
        return CacheRefreshManager.instance;
    }

    // 检查是否正在刷新缓存
    isRefreshingCaches(): boolean {
        return this.isRefreshing;
    }

    // 检查是否正在更新装饰
    isUpdatingDecorations(): boolean {
        return this.isDecorationUpdating;
    }

    // 等待缓存刷新完成
    async waitForCacheRefresh(): Promise<void> {
        if (this.refreshPromise) {
            await this.refreshPromise;
        }
    }

    // 等待装饰更新完成
    async waitForDecorationUpdate(): Promise<void> {
        if (this.decorationPromise) {
            await this.decorationPromise;
        }
    }

    // 设置装饰更新状态
    setDecorationUpdating(promise: Promise<void>): void {
        this.isDecorationUpdating = true;
        this.decorationPromise = promise;
        promise.finally(() => {
            this.isDecorationUpdating = false;
            this.decorationPromise = null;
        });
    }

    // 异步刷新配置缓存和分词缓存
    async refreshCaches(reason: string = '未知原因'): Promise<void> {
        if (this.isRefreshing) {
            console.log(`INI Config Navigator: 缓存刷新已在进行中，等待完成 - ${reason}`);
            await this.waitForCacheRefresh();
            return;
        }

        // 如果装饰正在更新，等待完成
        if (this.isDecorationUpdating) {
            console.log(`INI Config Navigator: 装饰更新中，等待完成后开始缓存刷新 - ${reason}`);
            await this.waitForDecorationUpdate();
        }

        this.isRefreshing = true;
        
        // 创建刷新 Promise
        this.refreshPromise = this.performCacheRefresh(reason);
        
        try {
            await this.refreshPromise;
        } finally {
            this.isRefreshing = false;
            this.refreshPromise = null;
        }
    }

    // 执行实际的缓存刷新操作
    private async performCacheRefresh(reason: string): Promise<void> {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "INI Config Navigator",
                cancellable: false
            }, async (progress, token) => {
                progress.report({ increment: 0, message: "刷新配置缓存..." });
                
                // 1. 刷新配置项缓存
                const configManager = ConfigSectionManager.getInstance();
                const configUpdated = await configManager.scanAllSections();
                
                progress.report({ increment: 50, message: "刷新分词缓存..." });
                
                // 2. 刷新分词缓存（依赖配置缓存）
                if (configUpdated) {
                    const tokenManager = FileTokenManager.getInstance();
                    await tokenManager.refreshAllTokens();
                }
                
                progress.report({ increment: 100, message: "缓存刷新完成" });
                
                console.log(`INI Config Navigator: 缓存刷新完成 - ${reason}`);
            });
        } catch (error) {
            console.error(`INI Config Navigator: 缓存刷新失败 - ${reason}:`, error);
            vscode.window.showErrorMessage(`缓存刷新失败: ${error}`);
            throw error;
        }
    }

    // 异步刷新特定INI文件
    async refreshIniFile(uri: vscode.Uri): Promise<void> {
        if (this.isRefreshing) {
            this.refreshQueue.add(uri.fsPath);
            console.log(`INI Config Navigator: 缓存刷新正在进行中，已加入队列 - ${path.basename(uri.fsPath)}`);
            return Promise.resolve();
        }

        this.isRefreshing = true;
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: `刷新 ${path.basename(uri.fsPath)}`,
                cancellable: false
            }, async (progress, token) => {
                progress.report({ increment: 0, message: "更新配置项..." });
                
                // 确保进度条至少显示 500ms
                const startTime = Date.now();
                
                // 1. 更新配置项缓存
                const configManager = ConfigSectionManager.getInstance();
                const updated = await configManager.updateIniFile(uri);
                
                progress.report({ increment: 50, message: "更新分词缓存..." });
                
                // 2. 强制更新所有文件的分词缓存（配置项变化会影响所有文件）
                const tokenManager = FileTokenManager.getInstance();
                await tokenManager.refreshAllTokens();
                
                console.log(`INI Config Navigator: INI文件处理完成 - ${path.basename(uri.fsPath)}, 配置更新: ${updated}`);
                
                // 确保最小显示时间
                const elapsed = Date.now() - startTime;
                if (elapsed < 500) {
                    await new Promise(resolve => setTimeout(resolve, 500 - elapsed));
                }
                
                progress.report({ increment: 100, message: "完成" });
            });
            
            console.log(`INI Config Navigator: refreshIniFile 方法完成 - ${path.basename(uri.fsPath)}`);
        } catch (error) {
            console.error(`INI Config Navigator: INI文件刷新失败:`, error);
        } finally {
            this.isRefreshing = false;
            
            // 处理队列中的其他刷新请求
            if (this.refreshQueue.size > 0) {
                const nextFile = Array.from(this.refreshQueue)[0];
                this.refreshQueue.delete(nextFile);
                setTimeout(() => this.refreshIniFile(vscode.Uri.file(nextFile)), 100);
            }
        }
    }

    // 异步刷新特定工作区文件的分词
    async refreshFileTokens(uri: vscode.Uri): Promise<boolean> {
        if (this.isRefreshing) {
            this.refreshQueue.add(uri.fsPath);
            return false;
        }

        this.isRefreshing = true;
        
        try {
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: `更新分词: ${path.basename(uri.fsPath)}`,
                cancellable: false
            }, async (progress, token) => {
                progress.report({ increment: 0, message: "分析文件内容..." });
                
                // 确保进度条至少显示 300ms
                const startTime = Date.now();
                
                const tokenManager = FileTokenManager.getInstance();
                const updated = await tokenManager.updateFileTokens(uri.fsPath);
                
                // 确保最小显示时间
                const elapsed = Date.now() - startTime;
                if (elapsed < 300) {
                    await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
                }
                
                progress.report({ increment: 100, message: "完成" });
                
                console.log(`INI Config Navigator: 文件分词刷新完成 - ${path.basename(uri.fsPath)}, 更新结果: ${updated}`);
                
                return updated; // 返回更新结果
            });
            return result || false;
        } catch (error) {
            console.error(`INI Config Navigator: 文件分词刷新失败:`, error);
            return false;
        } finally {
            this.isRefreshing = false;
            
            // 处理队列中的其他刷新请求
            if (this.refreshQueue.size > 0) {
                const nextFile = Array.from(this.refreshQueue)[0];
                this.refreshQueue.delete(nextFile);
                setTimeout(() => this.refreshFileTokens(vscode.Uri.file(nextFile)), 100);
            }
        }
    }

    isCurrentlyRefreshing(): boolean {
        return this.isRefreshing;
    }

    dispose(): void {
        this.refreshQueue.clear();
        this.isRefreshing = false;
    }
}

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

    // 获取所有文件的分词信息
    getAllFileTokens(): Map<string, Map<string, vscode.Range[]>> {
        return this.fileTokenCache;
    }

    // 获取特定配置项在文件中的位置（从缓存）
    getTokenRanges(filePath: string, sectionId: string): vscode.Range[] {
        const fileTokens = this.fileTokenCache.get(filePath);
        return fileTokens?.get(sectionId) || [];
    }

    // 刷新所有文件的分词缓存（依赖配置缓存）
    async refreshAllTokens(): Promise<void> {
        console.log('INI Config Navigator: 刷新所有文件分词缓存...');
        
        // 清空所有分词缓存和文件hash缓存，强制重新构建
        this.fileTokenCache.clear();
        this.fileHashCache.clear(); // 关键修复：清空hash缓存，强制重新扫描
        
        // 重新扫描所有相关文件
        await this.scanAllFiles();
    }

    // 更新特定文件的分词信息
    async updateFileTokens(filePath: string): Promise<boolean> {
        const uri = vscode.Uri.file(filePath);
        return this.scanFileTokens(uri);
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
    private pendingTimeout: NodeJS.Timeout | null = null;

    constructor() {
        this.configManager = ConfigSectionManager.getInstance();
        this.tokenManager = FileTokenManager.getInstance();
    }

    async provideDefinition(
        doc: vscode.TextDocument,
        pos: vscode.Position
    ): Promise<vscode.Definition> {
        // F12 跳转功能已禁用，请使用 hover 悬停提示中的跳转链接
        return [];
    }

    public async showLocationPicker(defLocation: vscode.Location, referenceLocations: vscode.Location[], targetId: string) {
        try {
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
            
            // 限制显示的引用数量，防止UI卡顿
            const MAX_DISPLAY_REFS = 20;
            const displayRefs = referenceLocations.slice(0, MAX_DISPLAY_REFS);
            const hiddenCount = Math.max(0, referenceLocations.length - MAX_DISPLAY_REFS);
            
            // 添加引用项 - 使用简化的上下文信息，避免大量文件读取
            for (let index = 0; index < displayRefs.length; index++) {
                const refLoc = displayRefs[index];
                const refFileName = path.basename(refLoc.uri.fsPath);
                const refRelativePath = vscode.workspace.asRelativePath(refLoc.uri);
                const fileType = refFileName.split('.').pop()?.toUpperCase() || '';
                
                items.push({
                    label: `📄 ${targetId}`,
                    description: `${refRelativePath}:${refLoc.range.start.line + 1}`,
                    detail: `${fileType} 文件引用`
                });
            }
            
            // 如果有隐藏的引用，添加提示
            if (hiddenCount > 0) {
                items.push({
                    label: `... 还有 ${hiddenCount} 个引用未显示`,
                    description: '为了性能考虑，仅显示前20个引用',
                    detail: '可以使用搜索功能查找更多引用'
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
                    await vscode.window.showTextDocument(defLocation.uri, {
                        selection: defLocation.range
                    });
                } else if (!selected.label.includes('还有')) {
                    const selectedIndex = items.indexOf(selected) - 1;
                    if (selectedIndex >= 0 && selectedIndex < displayRefs.length) {
                        const targetLoc = displayRefs[selectedIndex];
                        await vscode.window.showTextDocument(targetLoc.uri, {
                            selection: targetLoc.range
                        });
                    }
                }
            }
        } catch (error) {
            console.error('INI Config Navigator: 显示跳转选择面板时出错:', error);
            vscode.window.showErrorMessage('跳转功能出现错误，请重试');
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
        
        // 降级到异步文件读取
        try {
            const doc = await vscode.workspace.openTextDocument(defLocation.uri);
            const lines = doc.getText().split(/\r?\n/);
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
            // 尝试从已打开的文档获取内容，避免文件读取
            const openDoc = vscode.workspace.textDocuments.find(doc => 
                doc.uri.fsPath === refLocation.uri.fsPath
            );
            
            let lines: string[];
            if (openDoc) {
                lines = openDoc.getText().split(/\r?\n/);
            } else {
                // 使用异步读取代替同步读取
                const doc = await vscode.workspace.openTextDocument(refLocation.uri);
                lines = doc.getText().split(/\r?\n/);
            }
            
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
                md.isTrusted = true;
                md.supportHtml = true;
                
                // 添加配置项内容
                md.appendCodeblock(contentLines.join('\n'), 'ini');
                
                // 添加跳转链接
                const definitionCommandUri = vscode.Uri.parse(`command:w3x-ini-support.goToDefinition?${encodeURIComponent(JSON.stringify({
                    sectionId: targetId,
                    sourceUri: doc.uri.toString(),
                    position: { line: pos.line, character: pos.character }
                }))}`);
                
                const referencesCommandUri = vscode.Uri.parse(`command:w3x-ini-support.goToReferences?${encodeURIComponent(JSON.stringify({
                    sectionId: targetId,
                    sourceUri: doc.uri.toString(),
                    position: { line: pos.line, character: pos.character }
                }))}`);
                
                md.appendMarkdown(`\n\n---\n🎯 [跳转到定义](${definitionCommandUri}) | 📋 [查看所有引用](${referencesCommandUri})`);
                
                return new vscode.Hover(md, match.range);
            }
        } catch {
            // 忽略文件读取错误
        }
        
        // 降级到简单显示
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;
        
        md.appendMarkdown(`**INI配置项**: \`[${targetId}]\``);
        
        // 添加跳转链接
        const definitionCommandUri = vscode.Uri.parse(`command:w3x-ini-support.goToDefinition?${encodeURIComponent(JSON.stringify({
            sectionId: targetId,
            sourceUri: doc.uri.toString(),
            position: { line: pos.line, character: pos.character }
        }))}`);
        
        const referencesCommandUri = vscode.Uri.parse(`command:w3x-ini-support.goToReferences?${encodeURIComponent(JSON.stringify({
            sectionId: targetId,
            sourceUri: doc.uri.toString(),
            position: { line: pos.line, character: pos.character }
        }))}`);
        
        md.appendMarkdown(`\n\n🎯 [跳转到定义](${definitionCommandUri}) | 📋 [查看所有引用](${referencesCommandUri})`);
        
        return new vscode.Hover(md, match.range);
    }
}

// 装饰器提供者 - 实现局部渲染优化
class IniSectionDecorationProvider {
    private tokenManager: FileTokenManager;
    private fileTimeouts: Map<string, NodeJS.Timeout> = new Map(); // 每个文件的延迟定时器
    private fileDecorationCache: Map<string, vscode.DecorationOptions[]> = new Map(); // 文件装饰缓存
    private activeFiles: Set<string> = new Set(); // 跟踪打开的文件
    
    // 超大文件优化：分块渲染
    private chunkCache = new Map<string, Map<number, vscode.DecorationOptions[]>>(); // 分块缓存
    private visibleChunks = new Map<string, Set<number>>(); // 当前可见的块
    private static readonly CHUNK_SIZE = 200; // 每块200行
    private static readonly MAX_VISIBLE_CHUNKS = 15; // 最多同时渲染15块（约3000行）
    private static readonly PRELOAD_BUFFER = 500; // 预加载缓冲区500行
    
    // 性能监控
    private renderMetrics = new Map<string, {
        lastRenderTime: number;
        totalLines: number;
        activeChunks: number;
        lastVisibleRange: vscode.Range | null;
    }>();

    constructor() {
        this.tokenManager = FileTokenManager.getInstance();
    }

    // 计算行所属的块编号
    private getChunkIndex(lineNumber: number): number {
        return Math.floor(lineNumber / IniSectionDecorationProvider.CHUNK_SIZE);
    }

    // 获取块的行范围
    private getChunkRange(chunkIndex: number, totalLines: number): vscode.Range {
        const startLine = chunkIndex * IniSectionDecorationProvider.CHUNK_SIZE;
        const endLine = Math.min(startLine + IniSectionDecorationProvider.CHUNK_SIZE - 1, totalLines - 1);
        return new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
    }

    // 获取智能可见范围（考虑滚动方向和预加载）
    private getSmartVisibleRange(editor: vscode.TextEditor): { range: vscode.Range, chunks: Set<number> } {
        const visibleRanges = editor.visibleRanges;
        const totalLines = editor.document.lineCount;
        
        if (visibleRanges.length === 0) {
            const fallbackRange = new vscode.Range(0, 0, Math.min(totalLines - 1, 500), 0);
            return {
                range: fallbackRange,
                chunks: new Set([0, 1, 2])
            };
        }

        const firstVisible = visibleRanges[0];
        const lastVisible = visibleRanges[visibleRanges.length - 1];
        
        // 扩展预加载缓冲区
        const bufferStart = Math.max(0, firstVisible.start.line - IniSectionDecorationProvider.PRELOAD_BUFFER);
        const bufferEnd = Math.min(totalLines - 1, lastVisible.end.line + IniSectionDecorationProvider.PRELOAD_BUFFER);
        
        const smartRange = new vscode.Range(bufferStart, 0, bufferEnd, Number.MAX_SAFE_INTEGER);
        
        // 计算涉及的块
        const startChunk = this.getChunkIndex(bufferStart);
        const endChunk = this.getChunkIndex(bufferEnd);
        const chunks = new Set<number>();
        
        for (let i = startChunk; i <= endChunk; i++) {
            chunks.add(i);
        }
        
        // 限制最大块数，防止内存爆炸
        if (chunks.size > IniSectionDecorationProvider.MAX_VISIBLE_CHUNKS) {
            const centerChunk = this.getChunkIndex((firstVisible.start.line + lastVisible.end.line) / 2);
            const halfMax = Math.floor(IniSectionDecorationProvider.MAX_VISIBLE_CHUNKS / 2);
            
            chunks.clear();
            for (let i = centerChunk - halfMax; i <= centerChunk + halfMax; i++) {
                if (i >= 0 && i <= this.getChunkIndex(totalLines - 1)) {
                    chunks.add(i);
                }
            }
        }
        
        return { range: smartRange, chunks };
    }

    // 为单个块构建装饰
    private buildChunkDecorations(
        editor: vscode.TextEditor, 
        chunkIndex: number, 
        fileTokens: Map<string, vscode.Range[]>
    ): vscode.DecorationOptions[] {
        const decorations: vscode.DecorationOptions[] = [];
        const chunkRange = this.getChunkRange(chunkIndex, editor.document.lineCount);
        
        for (const [sectionId, ranges] of fileTokens) {
            for (const range of ranges) {
                // 检查范围是否在当前块内
                if (chunkRange.intersection(range)) {
                    decorations.push({
                        range
                        // 移除 hoverMessage，只保留纯装饰
                    });
                }
            }
        }
        
        return decorations;
    }

    // 判断是否为超大文件
    private isUltraLargeFile(editor: vscode.TextEditor): boolean {
        return editor.document.lineCount > 5000; // 5000行以上算超大文件
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
        
        // 检查是否正在刷新缓存，如果是则延迟装饰更新
        const cacheRefreshManager = CacheRefreshManager.getInstance();
        if (cacheRefreshManager.isRefreshingCaches()) {
            console.log(`INI Config Navigator: 缓存刷新中，跳过装饰更新 - ${path.basename(filePath)}`);
            return; // 直接返回，不进行装饰更新
        }

        const startTime = Date.now();
        
        // 从缓存获取该文件的分词信息
        const fileTokens = this.tokenManager.getFileTokens(filePath);
        console.log(`INI Config Navigator: 装饰器更新 - ${path.basename(filePath)}, 缓存分词数量: ${fileTokens ? fileTokens.size : 0}`);
        
        if (!fileTokens || fileTokens.size === 0) {
            // 没有缓存分词信息时，保持现有装饰不变，不清空
            console.log(`INI Config Navigator: 暂无缓存分词信息，保持现有装饰 - ${path.basename(filePath)}`);
            return; // 保持现有装饰，等待下次30秒更新
        }

        const totalLines = editor.document.lineCount;
        const isUltraLarge = this.isUltraLargeFile(editor);
        const isLarge = this.isLargeFile(editor);
        
        let allDecorations: vscode.DecorationOptions[] = [];
        let renderedChunks = 0;
        let totalChunks = 0;

        if (isUltraLarge) {
            // 超大文件：使用分块渲染
            const { range: smartRange, chunks: visibleChunkSet } = this.getSmartVisibleRange(editor);
            
            // 初始化文件的块缓存
            if (!this.chunkCache.has(filePath)) {
                this.chunkCache.set(filePath, new Map());
            }
            const fileChunkCache = this.chunkCache.get(filePath)!;
            
            // 更新可见块集合
            this.visibleChunks.set(filePath, visibleChunkSet);
            
            // 清理不再可见的块缓存
            for (const [chunkIndex] of fileChunkCache) {
                if (!visibleChunkSet.has(chunkIndex)) {
                    fileChunkCache.delete(chunkIndex);
                }
            }
            
            // 渲染可见块
            for (const chunkIndex of visibleChunkSet) {
                totalChunks++;
                
                // 检查块缓存
                if (!fileChunkCache.has(chunkIndex)) {
                    const chunkDecorations = this.buildChunkDecorations(editor, chunkIndex, fileTokens);
                    fileChunkCache.set(chunkIndex, chunkDecorations);
                }
                
                const chunkDecorations = fileChunkCache.get(chunkIndex)!;
                allDecorations.push(...chunkDecorations);
                renderedChunks++;
            }
            
            console.log(`INI Config Navigator: 超大文件 ${path.basename(filePath)} - 分块渲染 ${renderedChunks}/${Math.ceil(totalLines / IniSectionDecorationProvider.CHUNK_SIZE)} 块，装饰 ${allDecorations.length} 个`);
            
        } else if (isLarge) {
            // 大文件：使用智能可见范围
            const { range: renderRange } = this.getSmartVisibleRange(editor);
            
            for (const [sectionId, ranges] of fileTokens) {
                for (const range of ranges) {
                    // 只渲染智能可见范围内的装饰
                    if (renderRange.intersection(range)) {
                        allDecorations.push({
                            range
                            // 移除 hoverMessage，只保留纯装饰
                        });
                    }
                }
            }
            
            console.log(`INI Config Navigator: 大文件 ${path.basename(filePath)} - 智能范围渲染 ${allDecorations.length} 个装饰`);
            
        } else {
            // 小文件：全量渲染
            for (const [sectionId, ranges] of fileTokens) {
                for (const range of ranges) {
                    allDecorations.push({
                        range
                        // 移除 hoverMessage，只保留纯装饰
                    });
                }
            }
            
            console.log(`INI Config Navigator: 小文件 ${path.basename(filePath)} - 全量渲染 ${allDecorations.length} 个装饰`);
        }

        // 应用装饰
        console.log(`INI Config Navigator: 正在应用装饰 - ${path.basename(filePath)}, 装饰数量: ${allDecorations.length}, 文件行数: ${totalLines}`);
        editor.setDecorations(linkableTextDecorationType, allDecorations);
        console.log(`INI Config Navigator: 装饰已应用 - ${path.basename(filePath)}`);
        
        // 缓存装饰信息（小文件才缓存全量装饰）
        if (!isUltraLarge) {
            this.fileDecorationCache.set(filePath, allDecorations);
        }
        
        // 更新性能指标
        const renderTime = Date.now() - startTime;
        this.renderMetrics.set(filePath, {
            lastRenderTime: renderTime,
            totalLines,
            activeChunks: renderedChunks,
            lastVisibleRange: isUltraLarge ? null : editor.visibleRanges[0] || null
        });
        
        if (renderTime > 100) { // 超过100ms记录警告
            console.warn(`INI Config Navigator: 文件 ${path.basename(filePath)} 渲染耗时 ${renderTime}ms，建议优化`);
        }
    }

    triggerUpdateDecorations(editor: vscode.TextEditor): Promise<void> {
        const filePath = editor.document.uri.fsPath;
        
        // 标记文件为活跃状态
        this.activeFiles.add(filePath);

        return new Promise<void>((resolve) => {
            // 检查缓存状态，等待缓存刷新完成
            const checkAndUpdate = async () => {
                const cacheManager = CacheRefreshManager.getInstance();
                
                // 如果正在刷新缓存，等待完成
                if (cacheManager.isRefreshingCaches()) {
                    console.log(`INI Config Navigator: 缓存刷新中，等待完成后更新装饰 - ${path.basename(filePath)}`);
                    await cacheManager.waitForCacheRefresh();
                }
                
                // 缓存刷新完成后，执行装饰更新
                const fileTimeouts = this.fileTimeouts;
                const existingTimeout = fileTimeouts.get(filePath);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                }
                
                const isUltraLarge = this.isUltraLargeFile(editor);
                const debounceTime = isUltraLarge ? 50 : 100;
                
                const timeout = setTimeout(async () => {
                    await this.updateDecorations(editor);
                    fileTimeouts.delete(filePath);
                    console.log(`INI Config Navigator: 装饰更新完成 - ${path.basename(filePath)}`);
                    resolve();
                }, debounceTime);
                
                fileTimeouts.set(filePath, timeout);
            };
            
            checkAndUpdate().catch(error => {
                console.error(`INI Config Navigator: 装饰更新失败 - ${path.basename(filePath)}:`, error);
                resolve();
            });
        });
    }    // 处理滚动事件（超大文件专用，只更新可见块状态，不触发装饰更新）
    onScroll(editor: vscode.TextEditor) {
        if (!this.isUltraLargeFile(editor)) {
            return; // 非超大文件不需要滚动优化
        }
        
        const filePath = editor.document.uri.fsPath;
        
        // 检查是否需要更新可见块
        const currentMetrics = this.renderMetrics.get(filePath);
        if (!currentMetrics) {
            return;
        }
        
        const { chunks: newVisibleChunks } = this.getSmartVisibleRange(editor);
        const oldVisibleChunks = this.visibleChunks.get(filePath);
        
        // 更新可见块状态（装饰由30秒定时器处理）
        if (!oldVisibleChunks || !this.setsEqual(newVisibleChunks, oldVisibleChunks)) {
            this.visibleChunks.set(filePath, newVisibleChunks);
            console.log(`INI Config Navigator: 超大文件滚动，更新可见块 - ${path.basename(filePath)}`);
        }
    }

    // 辅助方法：比较两个Set是否相等
    private setsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
        if (set1.size !== set2.size) {
            return false;
        }
        for (const item of set1) {
            if (!set2.has(item)) {
                return false;
            }
        }
        return true;
    }

    // 当文件被打开时调用（只记录状态，不触发装饰更新）
    onFileOpened(editor: vscode.TextEditor): void {
        const filePath = editor.document.uri.fsPath;
        this.activeFiles.add(filePath);
        console.log(`INI Config Navigator: 文件已打开 - ${path.basename(filePath)}，装饰将由30秒定时器更新`);
    }

    // 当文件被关闭时调用
    onFileClosed(filePath: string): void {
        // 清理该文件的所有相关缓存和定时器
        this.activeFiles.delete(filePath);
        this.fileDecorationCache.delete(filePath);
        this.chunkCache.delete(filePath);
        this.visibleChunks.delete(filePath);
        this.renderMetrics.delete(filePath);
        
        const timeout = this.fileTimeouts.get(filePath);
        if (timeout) {
            clearTimeout(timeout);
            this.fileTimeouts.delete(filePath);
        }
        
        console.log(`INI Config Navigator: 清理文件装饰缓存 - ${path.basename(filePath)}`);
    }

    // 批量更新多个编辑器的装饰（解决全局装饰类型冲突问题）
    async updateMultipleEditorsDecorations(editors: vscode.TextEditor[]): Promise<void> {
        if (!editors || editors.length === 0) {
            return;
        }

        console.log(`INI Config Navigator: 开始批量更新 ${editors.length} 个编辑器的装饰`);

        // 为每个编辑器准备装饰数据，但不立即应用
        const editorDecorations = new Map<vscode.TextEditor, vscode.DecorationOptions[]>();

        for (const editor of editors) {
            const filePath = editor.document.uri.fsPath;
            const fileName = path.basename(filePath);

            // 检查是否正在刷新缓存
            const cacheRefreshManager = CacheRefreshManager.getInstance();
            if (cacheRefreshManager.isRefreshingCaches()) {
                console.log(`INI Config Navigator: 缓存刷新中，跳过 ${fileName}`);
                continue;
            }

            // 从缓存获取该文件的分词信息，如果没有则主动构建
            let fileTokens = this.tokenManager.getFileTokens(filePath);
            if (!fileTokens || fileTokens.size === 0) {
                console.log(`INI Config Navigator: 文件无缓存，主动构建 - ${fileName}`);
                await this.tokenManager.updateFileTokens(filePath);
                fileTokens = this.tokenManager.getFileTokens(filePath);
                
                // 如果构建后仍然没有分词信息，跳过
                if (!fileTokens || fileTokens.size === 0) {
                    console.log(`INI Config Navigator: 构建缓存后仍无分词信息，跳过 ${fileName}`);
                    continue;
                }
            }

            const totalLines = editor.document.lineCount;
            const isUltraLarge = this.isUltraLargeFile(editor);
            const isLarge = this.isLargeFile(editor);
            
            let allDecorations: vscode.DecorationOptions[] = [];

            if (isUltraLarge) {
                // 超大文件：使用分块渲染
                const { range: smartRange, chunks: visibleChunkSet } = this.getSmartVisibleRange(editor);
                
                // 初始化文件的块缓存
                if (!this.chunkCache.has(filePath)) {
                    this.chunkCache.set(filePath, new Map());
                }
                const fileChunkCache = this.chunkCache.get(filePath)!;
                
                // 更新可见块集合
                this.visibleChunks.set(filePath, visibleChunkSet);
                
                // 清理不再可见的块缓存
                for (const [chunkIndex] of fileChunkCache) {
                    if (!visibleChunkSet.has(chunkIndex)) {
                        fileChunkCache.delete(chunkIndex);
                    }
                }
                
                // 渲染可见块
                for (const chunkIndex of visibleChunkSet) {
                    // 检查块缓存
                    if (!fileChunkCache.has(chunkIndex)) {
                        const chunkDecorations = this.buildChunkDecorations(editor, chunkIndex, fileTokens);
                        fileChunkCache.set(chunkIndex, chunkDecorations);
                    }
                    
                    const chunkDecorations = fileChunkCache.get(chunkIndex)!;
                    allDecorations.push(...chunkDecorations);
                }
                
            } else if (isLarge) {
                // 大文件：使用智能可见范围
                const { range: renderRange } = this.getSmartVisibleRange(editor);
                
                for (const [sectionId, ranges] of fileTokens) {
                    for (const range of ranges) {
                        // 只渲染智能可见范围内的装饰
                        if (renderRange.intersection(range)) {
                            allDecorations.push({ range });
                        }
                    }
                }
                
            } else {
                // 小文件：全量渲染
                for (const [sectionId, ranges] of fileTokens) {
                    for (const range of ranges) {
                        allDecorations.push({ range });
                    }
                }
            }

            // 存储装饰数据，稍后批量应用
            editorDecorations.set(editor, allDecorations);
            console.log(`INI Config Navigator: 准备装饰 ${fileName} - ${allDecorations.length} 个`);
        }

        // 批量应用所有装饰（这是关键：一次性为所有编辑器设置装饰）
        console.log(`INI Config Navigator: 开始批量应用装饰到 ${editorDecorations.size} 个编辑器`);
        
        for (const [editor, decorations] of editorDecorations) {
            const fileName = path.basename(editor.document.fileName);
            console.log(`INI Config Navigator: 应用装饰 ${fileName} - ${decorations.length} 个`);
            editor.setDecorations(linkableTextDecorationType, decorations);
            
            // 缓存装饰信息（小文件才缓存全量装饰）
            const filePath = editor.document.uri.fsPath;
            if (!this.isUltraLargeFile(editor)) {
                this.fileDecorationCache.set(filePath, decorations);
            }
        }

        console.log(`INI Config Navigator: 批量装饰更新完成 - 处理了 ${editorDecorations.size} 个编辑器`);
    }

    // 清理所有装饰缓存
    dispose(): void {
        // 清理所有文件的定时器
        for (const timeout of this.fileTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.fileTimeouts.clear();
        
        // 清理所有缓存
        this.fileDecorationCache.clear();
        this.chunkCache.clear();
        this.visibleChunks.clear();
        this.renderMetrics.clear();
        this.activeFiles.clear();
        
        console.log('INI Config Navigator: 装饰器已释放所有资源');
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




export async function activate(context: vscode.ExtensionContext) {
	console.log('w3x_ini_support is now active!');
	
	// 初始化管理器
	const configManager = ConfigSectionManager.getInstance();
	const tokenManager = FileTokenManager.getInstance();
	const cacheRefreshManager = CacheRefreshManager.getInstance();
	const decorationProvider = new IniSectionDecorationProvider();

	// 语言选择器
	const iniLuaSelector = [
		{ language: 'ini', scheme: 'file' },
		{ language: 'lua', scheme: 'file' },
		{ language: 'plaintext', scheme: 'file' },
		{ language: 'typescript', scheme: 'file' },
		{ language: 'markdown', scheme: 'file' }
	];

	// 初始化缓存（只初始化缓存，装饰在编辑器激活时更新）
	const initializeCaches = async () => {
		console.log(`INI Config Navigator: 开始初始化缓存`);
		await cacheRefreshManager.refreshCaches('扩展激活初始化');
		console.log(`INI Config Navigator: 缓存初始化完成，装饰将在编辑器激活时更新`);
		
		// 如果当前有激活的编辑器，立即为其应用装饰
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && activeEditor.document.uri.scheme === 'file' && isRelevantFile(activeEditor.document.fileName)) {
			console.log(`INI Config Navigator: 初始化后为当前激活编辑器应用装饰 - ${path.basename(activeEditor.document.fileName)}`);
			await decorationUpdateManager.updateActiveEditor(activeEditor);
		}
	};

	// 立即初始化
	initializeCaches();

	// 注册自定义命令：直接跳转到定义
	const goToDefinitionCommand = vscode.commands.registerCommand(
		'w3x-ini-support.goToDefinition',
		async (args: { sectionId: string, sourceUri: string, position: { line: number, character: number } }) => {
			try {
				const defLocation = configManager.getSectionLocation(args.sectionId);
				if (!defLocation) {
					vscode.window.showInformationMessage(`未找到配置项 "${args.sectionId}" 的定义`);
					return;
				}

				// 直接跳转到定义位置
				await vscode.window.showTextDocument(defLocation.uri, {
					selection: defLocation.range
				});
			} catch (error) {
				console.error('INI Config Navigator: 跳转定义命令出错:', error);
				vscode.window.showErrorMessage('跳转定义功能出现错误，请重试');
			}
		}
	);

	// 注册自定义命令：跳转到引用（显示选择面板）
	const goToReferencesCommand = vscode.commands.registerCommand(
		'w3x-ini-support.goToReferences',
		async (args: { sectionId: string, sourceUri: string, position: { line: number, character: number } }) => {
			try {
				const defLocation = configManager.getSectionLocation(args.sectionId);
				if (!defLocation) {
					vscode.window.showInformationMessage(`未找到配置项 "${args.sectionId}" 的定义`);
					return;
				}

				// 查找所有引用位置
				const referenceLocations: vscode.Location[] = [];
				const tokenManager = FileTokenManager.getInstance();
				const allFileTokens = tokenManager.getAllFileTokens();
				
				// 遍历所有文件的分词，查找引用
				for (const [filePath, tokens] of allFileTokens.entries()) {
					// 跳过定义文件本身
					if (filePath === defLocation.uri.fsPath) {
						continue;
					}
					
					const fileTokens = tokens.get(args.sectionId);
					if (fileTokens && fileTokens.length > 0) {
						for (const token of fileTokens) {
							const refLocation = new vscode.Location(
								vscode.Uri.file(filePath),
								token  // token 本身就是 Range
							);
							referenceLocations.push(refLocation);
						}
					}
				}

				// 创建临时提供者并调用跳转面板
				const tempProvider = new IniSectionDefinitionProvider();
				await tempProvider.showLocationPicker(defLocation, referenceLocations, args.sectionId);
			} catch (error) {
				console.error('INI Config Navigator: 跳转引用命令出错:', error);
				vscode.window.showErrorMessage('跳转引用功能出现错误，请重试');
			}
		}
	);
	context.subscriptions.push(goToDefinitionCommand, goToReferencesCommand);

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

	// 创建装饰更新管理器并启动定时更新
	const decorationUpdateManager = DecorationUpdateManager.getInstance();
	decorationUpdateManager.setDecorationProvider(decorationProvider);
	
	// 不再使用定时器，只在编辑器激活时更新装饰
	console.log(`INI Config Navigator: 装饰更新管理器已初始化，将在编辑器激活时更新装饰`);

	context.subscriptions.push(
		// 编辑器切换时立即应用装饰（确保后台文件切换到前台时有装饰）
		vscode.window.onDidChangeActiveTextEditor(async editor => {
			if (editor && editor.document.uri.scheme === 'file' && isRelevantFile(editor.document.fileName)) {
				// 使用装饰更新管理器的统一方法
				await decorationUpdateManager.updateActiveEditor(editor);
			}
		}),

		// 文档内容变化时的增量更新（仅处理非INI文件，只更新缓存不触发装饰）
		vscode.workspace.onDidChangeTextDocument(async event => {
			const filePath = event.document.uri.fsPath;
			
			// 只处理非INI文件，INI文件在保存时处理
			if (isRelevantFile(filePath) && !filePath.endsWith('.ini')) {
				// 检查是否正在刷新缓存，如果是则跳过文件级别的刷新
				const cacheRefreshManager = CacheRefreshManager.getInstance();
				if (cacheRefreshManager.isRefreshingCaches()) {
					console.log(`INI Config Navigator: 全局缓存刷新中，跳过文件级刷新 - ${path.basename(filePath)}`);
					return;
				}
				
				// 工作区文件变化：只更新缓存，装饰由30秒定时器处理
				console.log(`INI Config Navigator: 检测到工作区文件变化，启动分词刷新 - ${path.basename(filePath)}`);
				
				const updated = await cacheRefreshManager.refreshFileTokens(event.document.uri);
				console.log(`INI Config Navigator: 文件分词刷新完成 - ${path.basename(filePath)}, 更新结果: ${updated}`);
			}
		}),
		
		// 文件关闭时清理缓存（不触发装饰更新）
		vscode.workspace.onDidCloseTextDocument(document => {
			const filePath = document.uri.fsPath;
			if (isRelevantFile(filePath)) {
				console.log(`INI Config Navigator: 文件关闭，清理缓存 - ${path.basename(filePath)}`);
				tokenManager.clearFileCache(filePath);
				decorationProvider.onFileClosed(filePath);
			}
		}),
		
		// 文件保存时的额外处理
		vscode.workspace.onDidSaveTextDocument(async document => {
			const filePath = document.uri.fsPath;
			
			if (filePath.endsWith('.ini')) {
				try {
					// INI文件保存：需要刷新所有缓存，因为一个INI文件的变化可能影响整个系统
					console.log(`INI Config Navigator: INI文件保存，启动完整系统缓存刷新 - ${path.basename(filePath)}`);
					
					// 保存前的状态
					const beforeConfig = configManager.getAllSectionIds().length;
					console.log(`INI Config Navigator: 保存前配置项数量: ${beforeConfig}`);
					
					// 完全刷新所有缓存（INI + 分词）
					console.log(`INI Config Navigator: 开始完整缓存刷新（所有INI文件 + 所有分词）...`);
					await cacheRefreshManager.refreshCaches('INI文件保存触发');
					console.log(`INI Config Navigator: 完整缓存刷新完成 ✅`);
					
					// 保存后的状态
					const afterConfig = configManager.getAllSectionIds().length;
					console.log(`INI Config Navigator: 保存后配置项数量: ${afterConfig}，变化: ${afterConfig - beforeConfig}`);
					
					// 缓存刷新完成后，为当前激活的编辑器更新装饰
					const activeEditor = vscode.window.activeTextEditor;
					if (activeEditor && activeEditor.document.uri.scheme === 'file' && isRelevantFile(activeEditor.document.fileName)) {
						console.log(`INI Config Navigator: INI保存后为当前激活编辑器更新装饰 - ${path.basename(activeEditor.document.fileName)}`);
						await decorationUpdateManager.updateActiveEditor(activeEditor);
					}
					
					console.log(`INI Config Navigator: INI文件保存处理完成 🎉`);
					
				} catch (error) {
					console.error(`INI Config Navigator: INI文件保存处理失败:`, error);
				}
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// 清理装饰更新管理器
	const decorationUpdateManager = DecorationUpdateManager.getInstance();
	decorationUpdateManager.dispose();
	
	// 清理装饰器
	if (linkableTextDecorationType) {
		linkableTextDecorationType.dispose();
	}
	
	// 清理缓存管理器
	CacheRefreshManager.getInstance().dispose();
	ConfigSectionManager.getInstance().dispose();
	FileTokenManager.getInstance().dispose();
	
	console.log('INI Config Navigator: 扩展已卸载，缓存已清理');
}
