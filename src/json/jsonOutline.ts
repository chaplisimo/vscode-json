import * as vscode from "vscode";
import * as json from "jsonc-parser";
import * as path from "path";

export class JsonOutlineProvider implements vscode.TreeDataProvider<number> {
  private _onDidChangeTreeData: vscode.EventEmitter<number | null> =
    new vscode.EventEmitter<number | null>();
  readonly onDidChangeTreeData: vscode.Event<number | null> =
    this._onDidChangeTreeData.event;

  private tree: json.Node;
  private text: string;
  private editor: vscode.TextEditor;
  private autoRefresh = true;
  private label: string = null;
  private lockedEditor = false;

  constructor(private context: vscode.ExtensionContext) {
    vscode.window.onDidChangeActiveTextEditor(() =>
      this.onActiveEditorChanged()
    );
    vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e));
    this.parseTree();
    this.autoRefresh = vscode.workspace
      .getConfiguration("JSON-zain.json")
      .get("autorefresh");
    vscode.workspace.onDidChangeConfiguration(() => {
      this.autoRefresh = vscode.workspace
        .getConfiguration("JSON-zain.json")
        .get("autorefresh");
    });
    this.onActiveEditorChanged();
    vscode.commands.executeCommand("setContext","jsonOutlineLockedEditor",this.lockedEditor);
  }

  refresh(offset?: number): void {
    this.parseTree();
    if (offset) {
      this._onDidChangeTreeData.fire(offset);
    } else {
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  assignLabel(): void {
    vscode.window
      .showInputBox({ prompt: "Pick an attribute to select as object label" })
      .then((label) => {
        if (label !== null && label !== undefined) {
          this.label = label;
        } else {
          this.label = null;
        }
      })
      .then(
        () => this.refresh(),
        () => this.refresh()
      );
  }

  lockEditor(lock: boolean): void {
    this.lockedEditor = lock;
    //vscode.commands.executeCommand('setContext', 'jsonOutlineLockedEditor', this.lockedEditor);
    vscode.commands.executeCommand("setContext","jsonOutlineLockedEditor",this.lockedEditor);
  }

  rename(offset: number): void {
    vscode.window
      .showInputBox({ placeHolder: "Enter the new label" })
      .then((value) => {
        if (value !== null && value !== undefined) {
          this.editor.edit((editBuilder) => {
            const path = json.getLocation(this.text, offset).path;
            let propertyNode = json.findNodeAtLocation(this.tree, path);
            if (propertyNode.parent.type !== "array") {
              propertyNode = propertyNode.parent.children[0];
            }
            const range = new vscode.Range(
              this.editor.document.positionAt(propertyNode.offset),
              this.editor.document.positionAt(
                propertyNode.offset + propertyNode.length
              )
            );
            editBuilder.replace(range, `"${value}"`);
            setTimeout(() => {
              this.parseTree();
              this.refresh(offset);
            }, 100);
          });
        }
      });
  }

  private onActiveEditorChanged(): void {
    if (vscode.window.activeTextEditor) {
      if (vscode.window.activeTextEditor.document.uri.scheme === "file") {
        const enabled =
          vscode.window.activeTextEditor.document.languageId === "json" ||
          vscode.window.activeTextEditor.document.languageId === "jsonc";
        vscode.commands.executeCommand(
          "setContext",
          "jsonOutlineEnabled",
          enabled
        );
        // if (enabled) {
        // 	this.refresh();
        // }
      }
    } else {
      vscode.commands.executeCommand("setContext", "jsonOutlineEnabled", false);
    }
    // 切换文件，刷新
    if (!this.lockedEditor) {
      this.refresh();
    }
  }

  private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
    if (
      this.autoRefresh &&
      changeEvent.document.uri.toString() ===
        this.editor.document.uri.toString()
    ) {
      for (const change of changeEvent.contentChanges) {
        const path = json.getLocation(
          this.text,
          this.editor.document.offsetAt(change.range.start)
        ).path;
        path.pop();
        const node = path.length
          ? json.findNodeAtLocation(this.tree, path)
          : void 0;
        this.parseTree();
        this._onDidChangeTreeData.fire(node ? node.offset : void 0);
      }
    }
  }

  private parseTree(): void {
    this.text = "";
    this.tree = null;
    this.editor = vscode.window.activeTextEditor;
    if (this.editor && this.editor.document) {
      this.text = this.editor.document.getText();
      this.tree = json.parseTree(this.text);
    }
  }

  getChildren(offset?: number): Thenable<number[]> {
    if (offset) {
      const path = json.getLocation(this.text, offset).path;
      const node = json.findNodeAtLocation(this.tree, path);
      return Promise.resolve(this.getChildrenOffsets(node));
    } else {
      return Promise.resolve(
        this.tree ? this.getChildrenOffsets(this.tree) : []
      );
    }
  }

  private getChildrenOffsets(node: json.Node): number[] {
    const offsets: number[] = [];
    if (node && node.children) {
      for (const child of node.children) {
        const childPath = json.getLocation(this.text, child.offset).path;
        const childNode = json.findNodeAtLocation(this.tree, childPath);
        if (childNode) {
          offsets.push(childNode.offset);
        }
      }
    }
    return offsets;
  }

  getTreeItem(offset: number): vscode.TreeItem {
    const path = json.getLocation(this.text, offset).path;
    const valueNode = json.findNodeAtLocation(this.tree, path);
    if (valueNode) {
      const hasChildren =
        valueNode.type === "object" || valueNode.type === "array";
      const treeItem: vscode.TreeItem = new vscode.TreeItem(
        this.getLabel(valueNode),
        hasChildren
          ? valueNode.type === "object"
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      );
      treeItem.command = {
        command: "extension.openJsonSelection",
        title: "",
        arguments: [
          new vscode.Range(
            this.editor.document.positionAt(valueNode.offset),
            this.editor.document.positionAt(valueNode.offset + valueNode.length)
          ),
        ],
      };
      treeItem.iconPath = this.getIcon(valueNode);
      treeItem.contextValue = valueNode.type;
      return treeItem;
    }
    return null;
  }

  select(range: vscode.Range) {
    this.editor.selection = new vscode.Selection(range.start, range.end);
    // 编辑窗跳转到指定范围
    this.editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  private getIcon(node: json.Node): any {
    const nodeType = node.type;
    if (nodeType === "boolean") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "boolean.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "boolean.svg")
        ),
      };
    } else if (nodeType === "string") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "string.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "string.svg")
        ),
      };
    } else if (nodeType === "number") {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "number.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "number.svg")
        ),
      };
    } else if (
      nodeType === "object" &&
      node.children.some(
        (child) =>
          child.children[0].value.toString() == "logLevel" &&
          child.children[1].value.toString() == "DEBUG"
      )
    ) {
      return {
        light: this.context.asAbsolutePath(
          path.join("resources", "light", "flag-light.svg")
        ),
        dark: this.context.asAbsolutePath(
          path.join("resources", "dark", "flag-dark.svg")
        ),
      };
    }
    return null;
  }

  private getLabel(node: json.Node): string {
    if (node.parent.type === "array") {
      const prefix = node.parent.children.indexOf(node).toString();
      if (node.type === "object") {
        if (
          this.label !== null &&
          node.children.some(
            (child) => child.children[0].value.toString() == this.label
          )
        ) {
          const label = node.children
            .find((child) => child.children[0].value.toString() == this.label)
            .children[1].value.toString();
          return "{ " + this.getNodeChildrenCount(node) + " } " + label;
        } else return prefix + ": { " + this.getNodeChildrenCount(node) + " }";
      }
      if (node.type === "array") {
        return prefix + ": [ " + this.getNodeChildrenCount(node) + " ]";
      }
      return prefix + ":" + node.value.toString();
    } else {
      const property = node.parent.children[0].value.toString();
      if (node.type === "array" || node.type === "object") {
        if (node.type === "object") {
          if (
            this.label !== null &&
            node.children.some(
              (child) => child.children[0].value.toString() == this.label
            )
          ) {
            const label = node.children
              .find((child) => child.children[0].value.toString() == this.label)
              .children[1].value.toString();
            return "{ " + this.getNodeChildrenCount(node) + " } " + label;
          } else
            return "{ " + this.getNodeChildrenCount(node) + " } " + property;
        }
        if (node.type === "array") {
          return "[ " + this.getNodeChildrenCount(node) + " ] " + property;
        }
      }
      const value = this.editor.document.getText(
        new vscode.Range(
          this.editor.document.positionAt(node.offset),
          this.editor.document.positionAt(node.offset + node.length)
        )
      );
      return `${property}: ${value}`;
    }
  }

  private getNodeChildrenCount(node: json.Node): string {
    let count = "";
    if (node && node.children) {
      count = node.children.length + "";
    }
    return count;
  }
}
