
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

export function activate(context: vscode.ExtensionContext) {

	console.log('w3x_ini_support is now active!');

	// 新增 GoTo Definition
    const iniSelector = { language: 'ini', scheme: 'file' };
    const defProvider = vscode.languages.registerDefinitionProvider(
        iniSelector,
        new IniSectionDefinitionProvider()
    );
    context.subscriptions.push(defProvider);

	

}

// This method is called when your extension is deactivated
export function deactivate() {}
